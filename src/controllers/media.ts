import crypto from "crypto";
import { Request, Response } from "express";

import app from "../app.js";
import { connect } from "../lib/database.js";
import { logger } from "../lib/logger.js";
import { ParseAuthEvent } from "../lib/nostr/NIP98.js";
import { requestQueue } from "../lib/transform.js";
import {
	allowedMimeTypes,
	asyncTask,
	ConvertFilesOpions,
	MediaExtraDataResultMessage,
	MediaResultMessage,
	mediaTypes,
	mime_transform,
	ResultMessage,
	UploadStatus,
	UploadTypes
} from "../types.js";
import fs from "fs";
import config, { has } from "config";
import {fileTypeFromBuffer} from 'file-type';
import path from "path";


const Uploadmedia = async (req: Request, res: Response): Promise<Response> => {
	logger.info("POST /api/v1/media", "|", req.socket.remoteAddress);

	//Check if event authorization header is valid (NIP98)
	const EventHeader = await ParseAuthEvent(req);

	let username : string;
	let pubkey : string;

	//v0 compatibility, check if apikey is present on request body
	if (req.body.apikey != undefined && req.body.apikey != "") {
		
		logger.warn("Detected apikey on request body ", "|", req.socket.remoteAddress);

		//Check if apikey is valid
		try{
		let dbApikey = await connect();
		const [dbResult] = await dbApikey.query("SELECT hex, username FROM registered WHERE apikey = ?", [req.body.apikey]);
		const rowstemp = JSON.parse(JSON.stringify(dbResult));
		if (rowstemp[0] == undefined) {
			logger.warn("RES -> 401 unauthorized - Apikey not found", "|", req.socket.remoteAddress);
			const result: ResultMessage = {
				result: false,
				description: "Apikey is deprecated, please use NIP98 header. Error: Apikey not found",
			};
			return res.status(401).send(result);
		}

		dbApikey.end();

		//We set eventheader.result as valid if apikey is present and valid.
		EventHeader.result = true;
		EventHeader.description = "Apikey is deprecated, please use NIP98 header";
		EventHeader.pubkey = rowstemp[0].hex;
		username = rowstemp[0].username;

		logger.warn("(APIKEY) -> Setting username = " + username + " and pubkey = " + EventHeader.pubkey, "|", req.socket.remoteAddress);

		}
		catch (error: any) {
			logger.error("Error checking apikey", error.message);
			const result: ResultMessage = {
				result: false,
				description: "Apikey is deprecated, please use NIP98 header: Error checking apikey",
			};
			return res.status(500).send(result);
			
		}
	};	

	if (!EventHeader.result) {
		logger.warn(
			`RES -> 401 unauthorized - ${EventHeader.description}`,
			"|",
			req.socket.remoteAddress
		);
		const result: ResultMessage = {
			result: false,
			description: EventHeader.description,
		};

		return res.status(401).send(result);
	}

	//Check if pubkey is registered
	pubkey = EventHeader.pubkey;
	const dbPubkey = await connect();
	const [dbResult] = await dbPubkey.query("SELECT hex, username FROM registered WHERE hex = ?", [pubkey]);
	const rowstemp = JSON.parse(JSON.stringify(dbResult));

	if (rowstemp[0] == undefined) {
		//If not registered the upload will be public and a warning will be logged
		logger.warn("pubkey not registered, switching to public upload | ", req.socket.remoteAddress);
		username = "public";
		pubkey = app.get("pubkey");

		logger.info("assuming public pubkey =", pubkey, "|", req.socket.remoteAddress);
		logger.info("assuming public username =", username, "|", req.socket.remoteAddress);

	}else{
		username = rowstemp[0]['username'];
		logger.info("username ->", username, "|", req.socket.remoteAddress);
		logger.info("pubkey ->", pubkey, "|", req.socket.remoteAddress);
	}

	dbPubkey.end();

	//Check if upload type exists
	let uploadtype = req.body.uploadtype;

	//v0 compatibility, check if type is present on request body (v0 uses type instead of uploadtype)
	if (req.body.type != undefined && req.body.type != "") {
		logger.warn("Detected 'type' field (deprecated) on request body, setting 'uploadtype' with 'type' data ", "|", req.socket.remoteAddress);
		uploadtype = req.body.type;
		req.body.uploadtype = req.body.type;
	}

	if (!uploadtype) {
	//If upload type is not specified will be "media" and a warning will be logged
	logger.warn(`RES -> 400 Bad request - missing uploadtype`, "|", req.socket.remoteAddress);
	logger.warn("assuming uploadtype = media");
	req.body.uploadtype = "media";
	uploadtype = "media";
	}

	//Check if upload type is valid
	if (!UploadTypes.includes(uploadtype)) {
		logger.warn(`RES -> 400 Bad request - incorrect uploadtype`, "|", req.socket.remoteAddress);
		const result: ResultMessage = {
			result: false,
			description: "incorrect upload type",
		};

		return res.status(400).send(result);
	}
	logger.info("type ->", uploadtype, "|", req.socket.remoteAddress);

	//Check if the pubkey is public (the server pubkey) and uploadtype is different than media
	if (pubkey == app.get("pubkey") && uploadtype != "media") {
		logger.warn(`Public pubkey can only upload media files, setting uploadtype to media`, "|", req.socket.remoteAddress);
		req.body.uploadtype = "media";
		uploadtype = "media";
	}

	//Check if file exist on POST message
	const files = req.files as {[fieldname: string]: Express.Multer.File[]};
	let file: Express.Multer.File;
	if (files.mediafile == undefined) {
		if (files.publicgallery == undefined) {
			logger.warn(`RES -> 400 Bad request - missing mediafile or publicgallery field`, "|", req.socket.remoteAddress);
			const result: ResultMessage = {
				result: false,
				description: "missing mediafile",
			};

			return res.status(400).send(result);
		}

		//v0 API deprecated field
		logger.warn("Detected 'publicgallery' field (deprecated) on request body, setting 'mediafile' with 'publicgallery' data ", "|", req.socket.remoteAddress);
		file = files['publicgallery'][0];
		req.file = file;


	}else{
		file = files['mediafile'][0];
		req.file = file;
	}

	if (!file) {
		logger.warn(`RES -> 400 Bad request - Empty file`, "|", req.socket.remoteAddress);
		const result: ResultMessage = {
			result: false,
			description: "Empty file",
		};

		return res.status(400).send(result);
	}

	//Detect file mime type
	const DetectedFileType = await fileTypeFromBuffer(file.buffer);
	if (DetectedFileType == undefined) {
		logger.error(`RES -> 400 Bad request - `, file.mimetype, ` filetype not detected`, "|", req.socket.remoteAddress);
		const result: ResultMessage = {
			result: false,
			description: "file type not detected",
		};
		return res.status(400).send(result);
	}
	file.mimetype = DetectedFileType.mime;

	//Check if filetype is allowed
	if (!allowedMimeTypes.includes(file.mimetype)) {
		logger.warn(
			`RES -> 400 Bad request - `,
			file.mimetype,
			` filetype not allowed`,
			"|",
			req.socket.remoteAddress
		);
		const result: ResultMessage = {
			result: false,
			description: "filetype not allowed",
		};

		return res.status(400).send(result);
	}
	logger.info("mime ->", file.mimetype, "|", req.socket.remoteAddress);

	//Standard conversion options
	const fileoptions: ConvertFilesOpions = {
		id: "",
		username: username,
		width: config.get("media.transform.media.undefined.width"),
		height: config.get("media.transform.media.undefined.height"),
		uploadtype,
		originalmime: file.mimetype,
		outputmime: mime_transform[file.mimetype],
		outputname: req.hostname + "_" + crypto.randomBytes(24).toString("hex"),
		outputoptions: "",
	};

	//Video or image conversion options
	if (file.mimetype.toString().startsWith("video")) {
		fileoptions.width = config.get("media.transform.media.video.width");
		fileoptions.height = config.get("media.transform.media.video.height");
		fileoptions.outputoptions = '-preset veryfast';
	}
	if (file.mimetype.toString().startsWith("image")) {
		fileoptions.width = config.get("media.transform.media.image.width");
		fileoptions.height = config.get("media.transform.media.image.height");
	}

	//Avatar conversion options
	if (fileoptions.uploadtype.toString() === "avatar"){
		fileoptions.width = config.get("media.transform.avatar.width");
		fileoptions.height = config.get("media.transform.avatar.height");
		fileoptions.outputname = "avatar";
	}

	//Banner conversion options
	if (fileoptions.uploadtype.toString() === "banner"){
		fileoptions.width = config.get("media.transform.banner.width");
		fileoptions.height = config.get("media.transform.banner.height");
		fileoptions.outputname = "banner";
	}

	//Add file to mediafiles table
	const dbFile = await connect();
	try{
		const createdate = new Date(Math.floor(Date.now())).toISOString().slice(0, 19).replace("T", " ");

		await dbFile.query(
			"INSERT INTO mediafiles (pubkey, filename, status, visibility, date, ip_address, comments) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[
				pubkey,
				`${fileoptions.outputname}.${fileoptions.outputmime}`,
				"pending",
				1,
				createdate,
				req.socket.remoteAddress,
				"comments",
			]
		);
		
		dbFile.end();
		
		}
		catch (error) {
			logger.error("Error inserting file to database", error);
			const result: ResultMessage = {
				result: false,
				description: "Error inserting file to database",
			};
			dbFile.end();
			return res.status(500).send(result);
		}
	
		//Get file ID
		const dbFileID = await connect();
		const [IDdbResult] = await dbFileID.query("SELECT id FROM mediafiles WHERE filename = ? and pubkey = ? ORDER BY ID DESC", [fileoptions.outputname + "." + fileoptions.outputmime, pubkey]);
		const IDrowstemp = JSON.parse(JSON.stringify(IDdbResult));
		if (IDrowstemp[0] == undefined) {
			logger.error("File not found in database:", fileoptions.outputname + "." + fileoptions.outputmime);
			const result: ResultMessage = {
				result: false,
				description: "The requested file was not found in database",
			};
	
			dbFileID.end();
			return res.status(404).send(result);
		}
		dbFileID.end();
	fileoptions.id = IDrowstemp[0].id;

	//If not exist create username folder
	const mediaPath = config.get("media.mediaPath") + username;
	if (!fs.existsSync(mediaPath)){
		fs.mkdirSync(mediaPath);
	}

	//Send request to transform queue
	const t: asyncTask = {
		req,
		fileoptions,
	};
	logger.info(`${requestQueue.length() +1} items in queue`);
	requestQueue.push(t).catch((err) => {
		logger.error("Error pushing file to queue", err);
		const result: ResultMessage = {
			result: false,
			description: "Error queueing file",

		};
		return result;
	});

	const servername = req.protocol + "://" + req.hostname;

	//Return file queued for conversion
	const returnmessage: MediaResultMessage = {
		result: true,
		description: "File queued for conversion",
	    status: JSON.parse(JSON.stringify(UploadStatus[0])),
		id: IDrowstemp[0].id,
		pubkey: pubkey,
		url: servername + "/media/" + username + "/" + fileoptions.outputname + "." + fileoptions.outputmime, //TODO, make it parametrizable",
	};

	return res.status(200).send(returnmessage);
};

const GetMediaStatusbyID = async (req: Request, res: Response) => {

	logger.info("GET /api/v1/media", "|", req.socket.remoteAddress);

	const servername = req.protocol + "://" + req.hostname + ":" + app.get("port"); 

	const EventHeader = await ParseAuthEvent(req);

	//v0 compatibility, check if apikey is present on request body
	if (req.query.apikey) {
		
		logger.warn("Detected apikey on query URL ", "|", req.socket.remoteAddress);
		logger.warn("Apikey:",req.query.apikey);

		//Check if apikey is valid
		try{
		let dbApikey = await connect();
		const [dbResult] = await dbApikey.query("SELECT hex, username FROM registered WHERE apikey = ?", [req.query.apikey]);
		const rowstemp = JSON.parse(JSON.stringify(dbResult));
		if (rowstemp[0] == undefined) {
			logger.warn("RES -> 401 unauthorized - Apikey not found", "|", req.socket.remoteAddress);
			const result: ResultMessage = {
				result: false,
				description: "Apikey is deprecated, please use NIP98 header. Error: Apikey not found",
			};
			return res.status(401).send(result);
		}

		dbApikey.end();

		//We set eventheader.result as valid if apikey is present and valid.
		EventHeader.result = true;
		EventHeader.description = "Apikey is deprecated, please use NIP98 header";
		EventHeader.pubkey = rowstemp[0].hex;

		logger.warn("Setting pubkey = " + EventHeader.pubkey, "|", req.socket.remoteAddress);

		}
		catch (error: any) {
			logger.error("Error checking apikey", error.message);
			const result: ResultMessage = {
				result: false,
				description: "Apikey is deprecated, please use NIP98 header: Error checking apikey",
			};
			return res.status(500).send(result);
			
		}
	};	

	//Check if event authorization header is valid (NIP98)
	if (!EventHeader.result) {
		logger.warn(
			`RES -> 401 unauthorized - ${EventHeader.description}`,
			"|",
			req.socket.remoteAddress
		);
		const result: ResultMessage = {
			result: false,
			description: EventHeader.description,
		};

		return res.status(401).send(result);
	}

	let id = req.params.id || req.query.id || "";
	if (!id) {
		logger.warn(`RES -> 400 Bad request - missing id`, "|", req.socket.remoteAddress);
		const result: ResultMessage = {
			result: false,
			description: "missing id",

		};

		return res.status(400).send(result);
	}

	

	logger.info(`GET /api/v1/media?id=${id}`, "|", req.socket.remoteAddress);

	const db = await connect();
	const [dbResult] = await db.query("SELECT mediafiles.id, mediafiles.filename, registered.username, mediafiles.pubkey, mediafiles.status FROM mediafiles INNER JOIN registered on mediafiles.pubkey = registered.hex WHERE (mediafiles.id = ? and mediafiles.pubkey = ?)", [id , EventHeader.pubkey]);
	let rowstemp = JSON.parse(JSON.stringify(dbResult));
	if (rowstemp[0] == undefined) {
		logger.warn(`File not found in database: ${req.query.id}, trying public server pubkey`, "|", req.socket.remoteAddress);
		const [dbResult] = await db.query("SELECT mediafiles.id, mediafiles.filename, registered.username, mediafiles.pubkey, mediafiles.status FROM mediafiles INNER JOIN registered on mediafiles.pubkey = registered.hex WHERE (mediafiles.id = ? and mediafiles.pubkey = ?)", [id , app.get("pubkey")]);
		rowstemp = JSON.parse(JSON.stringify(dbResult));
		if (rowstemp[0] == undefined) {
			logger.error(`File not found in database: ${req.query.id}`, "|", req.socket.remoteAddress);
		const result: ResultMessage = {
			result: false,
			description: "The requested file was not found",

		};
		db.end();
		return res.status(404).send(result);
		}
	}

	db.end();

	let url = "";
	let description = "";
	let resultstatus = false;
	let hash = "";
	let tags = [];
	let response = 200;

	if (rowstemp[0].status == "completed") {
		url = servername + "/media/" + rowstemp[0].username + "/" + rowstemp[0].filename; //TODO, make it parametrizable
		description = "The requested file was found";
		resultstatus = true;
		
		//Get file hash
		const dbHash = await connect();
		const [dbHashResult] = await dbHash.query("SELECT hash FROM mediafiles WHERE id = ?", [rowstemp[0].id]);
		const hashrowstemp = JSON.parse(JSON.stringify(dbHashResult));
		if (hashrowstemp[0] !== undefined) {
			hash = hashrowstemp[0].hash;
		}
		else{
			logger.error("Error getting file hash from database");
			hash = "Error getting hash from file";
		}
		dbHash.end();
		
		response = 200;
		logger.info(`RES -> ${response} - ${description}`, "|", req.socket.remoteAddress);
	}else if (rowstemp[0].status == "failed") {
		description = "It was a problem processing this file";
		resultstatus = false;
		response = 500;
		logger.info(`RES -> ${response} - ${description}`, "|", req.socket.remoteAddress);
	}else if (rowstemp[0].status == "pending") {
		description = "The requested file is still pending";
		resultstatus = false;
		response = 202;
		logger.info(`RES -> ${response} - ${description}`, "|", req.socket.remoteAddress);
	}else if (rowstemp[0].status == "processing") {
		description = "The requested file is processing";
		resultstatus = false;
		response = 202;
		logger.info(`RES -> ${response} - ${description}`, "|", req.socket.remoteAddress);
	}

	//Get file tags
	const dbTags = await connect();
	const [dbTagsResult] = await dbTags.query("SELECT tag FROM mediatags WHERE fileid = ?", [rowstemp[0].id]);
	const tagsrowstemp = JSON.parse(JSON.stringify(dbTagsResult));
	if (tagsrowstemp[0] !== undefined) {
		for (let i = 0; i < tagsrowstemp.length; i++) {
			tags.push(tagsrowstemp[i].tag);
		}
	}
	dbTags.end();

	const result: MediaExtraDataResultMessage = {
		result: resultstatus,
		description: description,
		url: url,
		status: rowstemp[0].status,
		id: rowstemp[0].id,
		pubkey: rowstemp[0].pubkey,
		hash: hash,
		tags: tags,
	};

	return res.status(202).send(result);
	
};

const GetMediabyURL = async (req: Request, res: Response) => {

	const root = path.normalize(path.resolve(config.get("media.mediaPath")));

	logger.info(`${req.method} ${req.url}` + " | " + req.socket.remoteAddress);

	let fileName = path.normalize(path.resolve("./" + req.url));

	const isPathUnderRoot = path
		.normalize(path.resolve(fileName))
		.startsWith(root);

	if (!isPathUnderRoot) {
		const result: ResultMessage = {
			result: false,
			description: "File not found",
		};
		return res.status(404).send(result);
	}

	const ext = path.extname(fileName)
	let mediaType :string = 'text/html'
	if (ext.length > 0 && mediaTypes.hasOwnProperty(ext.slice(1))) {
	mediaType = mediaTypes[ext.slice(1)]
	}

	fs.readFile(fileName, (err, data) => {
		if (err) {
			const result: ResultMessage = {
				result: false,
				description: "File not found",
			};
			return res.status(404).send(result);
		} else {
		res.setHeader('Content-Type', mediaType);
		res.end(data);
		}

	});

}

const GetMediaTagsbyID = async (req: Request, res: Response): Promise<Response> => {

	//Get available tags for a specific media file
	logger.info("REQ -> Media file tag list", "|", req.socket.remoteAddress);

	//Check if event authorization header is valid
	const EventHeader = await ParseAuthEvent(req);
	if (!EventHeader.result) {
		logger.warn(
			`RES -> 401 unauthorized  - ${EventHeader.description}`,
			"|",
			req.socket.remoteAddress
		);
		const result = {
			result: false,
			description: EventHeader.description,
		};

		return res.status(401).send(result);
	}
	logger.info("REQ -> Media tag list -> pubkey:", EventHeader.pubkey, "-> id:", req.params.fileId, "|", req.socket.remoteAddress);

	// //Check if pubkey is allowed to view available users
	// const allowed = IsAuthorizedPubkey(EventHeader.pubkey);
	// if (!allowed) {
	// 	logger.warn(
	// 		`RES -> 401 unauthorized  - ${EventHeader.description}`,
	// 		"|",
	// 		req.socket.remoteAddress
	// 	);

	// 	const result = {
	// 		result: false,
	// 		description: "Pubkey is not allowed to view available users",
	// 	};

	// 	return res.status(401).send(result);

	// }

	//Query database for media tags
	try {
		const conn = await connect();
		const [rows] = await conn.execute("SELECT tag FROM mediatags INNER JOIN mediafiles ON mediatags.fileid = mediafiles.id where fileid = ? and pubkey = ? ", [req.params.fileId, EventHeader.pubkey]);
		let rowstemp = JSON.parse(JSON.stringify(rows));

		if (rowstemp[0] !== undefined) {
			conn.end();
			logger.info("RES -> Media tag list ", "|", req.socket.remoteAddress);
			return res.status(200).send( JSON.parse(JSON.stringify(rows)));
		}else{
			//If not found, try with public server pubkey
			logger.info("Media tag list not found, trying with public server pubkey", "|", req.socket.remoteAddress);
			const [Publicrows] = await conn.execute("SELECT tag FROM mediatags INNER JOIN mediafiles ON mediatags.fileid = mediafiles.id where fileid = ? and pubkey = ?", [req.params.fileId, app.get("pubkey")]);
			let Publicrowstemp = JSON.parse(JSON.stringify(Publicrows));
			if (Publicrowstemp[0] !== undefined) {
				conn.end();
				logger.info("RES -> Media tag list ", "|", req.socket.remoteAddress);
				return res.status(200).send( JSON.parse(JSON.stringify(Publicrows)));
			}
		}

		conn.end();
		logger.warn("RES -> Empty media tag list ", "|", req.socket.remoteAddress);
		return res.status(404).send( JSON.parse(JSON.stringify({ "media tags": "No media tags found" })));
	} catch (error) {
		logger.error(error);

		return res.status(500).send({ description: "Internal server error" });
	}

};

const GetMediabyTags = async (req: Request, res: Response): Promise<Response> => {

	//Get media files by defined tags
	logger.info("REQ -> Media files for specified tag", "|", req.socket.remoteAddress);

	//Check if event authorization header is valid
	const EventHeader = await ParseAuthEvent(req);
	if (!EventHeader.result) {
		logger.warn(
			`RES -> 401 unauthorized  - ${EventHeader.description}`,
			"|",
			req.socket.remoteAddress
		);
		const result = {
			result: false,
			description: EventHeader.description,
		};

		return res.status(401).send(result);
	}
	logger.info("REQ -> Media files for specified tag -> pubkey:", EventHeader.pubkey, "-> tag:", req.params.tags, "|", req.socket.remoteAddress);

	//Check database for media files by tags
	try {
		const conn = await connect();
		const [rows] = await conn.execute("SELECT mediafiles.id, mediafiles.filename, registered.username, mediafiles.pubkey, mediafiles.status FROM mediatags INNER JOIN mediafiles ON mediatags.fileid = mediafiles.id INNER JOIN registered ON mediafiles.pubkey = registered.hex where tag = ? and mediafiles.pubkey = ? ", [req.params.tag, EventHeader.pubkey]);
		let rowstemp = JSON.parse(JSON.stringify(rows));

		if (rowstemp[0] !== undefined) {
			conn.end();
			logger.info("RES -> Media files for specified tag ", "|", req.socket.remoteAddress);
			const result = {
				result: true,
				description: "Media files found",
				mediafiles: rows,
			};
	
			return res.status(200).send(result);
		}else{
			//If not found, try with public server pubkey
			logger.info("Media files for specified tag not found, trying with public server pubkey", "|", req.socket.remoteAddress);
			const [Publicrows] = await conn.execute("SELECT mediafiles.id, mediafiles.filename, registered.username, mediafiles.pubkey, mediafiles.status FROM mediatags INNER JOIN mediafiles ON mediatags.fileid = mediafiles.id INNER JOIN registered ON mediafiles.pubkey = registered.hex where tag = ? and mediafiles.pubkey = ?", [req.params.tag, app.get("pubkey")]);
			let Publicrowstemp = JSON.parse(JSON.stringify(Publicrows));
			if (Publicrowstemp[0] !== undefined) {
				conn.end();
				logger.info("RES -> Media files for specified tag ", "|", req.socket.remoteAddress);
				const result = {
					result: true,
					description: "Media files found",
					mediafiles: Publicrows,
				};

				return res.status(200).send(result);
			}
		}

		conn.end();
		logger.warn("RES -> Empty media files for specified tag ", "|", req.socket.remoteAddress);
		return res.status(404).send( JSON.parse(JSON.stringify({ "media files": "No media files found" })));
	} catch (error) {
		logger.error(error);
		
		return res.status(500).send({ description: "Internal server error" });
	}

};


function isAnimatedGif(imageData: string): boolean {
	const base64 = imageData.substr(imageData.indexOf(',') + 1);
	const binaryString = Buffer.from(base64, 'base64').toString('binary');
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	const buffer = bytes.buffer;

	const HEADER_LEN = 6;                 // offset bytes for the header section
	const LOGICAL_SCREEN_DESC_LEN = 7;    // offset bytes for logical screen description section

	// Start from last 4 bytes of the Logical Screen Descriptor
	const dv = new DataView(buffer, HEADER_LEN + LOGICAL_SCREEN_DESC_LEN - 3);
	let offset = 0;
	const globalColorTable = dv.getUint8(0);	// aka packet byte
	let globalColorTableSize = 0;

	// check first bit, if 0, then we don't have a Global Color Table
	if (globalColorTable & 0x80) {
		// grab the last 3 bits, to calculate the global color table size -> RGB * 2^(N+1)
		// N is the value in the last 3 bits.
		globalColorTableSize = 3 * (2 ** ((globalColorTable & 0x7) + 1));
	}

	// move on to the Graphics Control Extension
	offset = 3 + globalColorTableSize;

	const extensionIntroducer = dv.getUint8(offset);
	const graphicsConrolLabel = dv.getUint8(offset + 1);
	let delayTime = 0;

	// Graphics Control Extension section is where GIF animation data is stored
	// First 2 bytes must be 0x21 and 0xF9
	if ((extensionIntroducer & 0x21) && (graphicsConrolLabel & 0xF9)) {
		// skip to the 2 bytes with the delay time
		delayTime = dv.getUint16(offset + 4);
	}

	return delayTime > 0;
}


export { GetMediaStatusbyID, GetMediabyURL, Uploadmedia, GetMediaTagsbyID, GetMediabyTags };