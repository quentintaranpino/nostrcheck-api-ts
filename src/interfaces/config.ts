
interface Modules {
	[key: string]: Module;
}

interface Module {
    enabled: boolean;
    path: string;
    methods: string[];
    description: string;
    name: string;
}

const necessaryKeys = [	
	"server.host", 
	"server.port", 
	"server.pubkey", 
	"server.secretKey", 
	"server.tosFilePath", 
	"database.host",
	"database.user",
	"database.password",
	"database.database"
]

const defaultConfig = {

	"environment" : "development",
	"server": {
		"host": "localhost",
		"port": 3000,
		"pubkey": "",
		"secretKey": "",
		"tosFilePath" : "resources/tos.md",
		"availableModules": {
		"nostraddress" :{
			"name": "nostraddress",
			"enabled": true,
			"path": "/nostraddress",
			"methods": ["GET"],
			"description": "This module returns the pubkey for a nostraddress name for each domain."
		},
		"media":{
			"name": "media",
			"enabled": true,
			"path": "/media",
			"methods": ["GET","POST","PUT","DELETE"],
			"description": "This module handles media uploads, downloads, media tags, etc."
		},
		"lightning" :{
			"name": "lightning",
			"enabled": true,
			"path": "/lightningaddress",
			"methods": ["GET","PUT", "DELETE"],
			"description": "This module handles ightning redirections for a nostraddress."
		},
		"verify" :{
			"name": "verify",
			"enabled": true,
			"path": "/verify",
			"methods": ["POST"],
			"description": "This module can verify a nostr note integrity and timestamp."
		},
		"register" : {
			"name": "register",
			"enabled": true,
			"path": "/register",
			"methods": ["POST"],
			"description": "This module handles usernames creation from trusted pubkeys."
		},
		"domains" : {
			"name": "domains",
			"enabled": true,
			"path": "/domains",
			"methods": ["GET", "PUT"],
			"description": "This module handle lists of registered domains and usernames."
		},
		"admin" : {
			"name": "admin",
			"enabled": true,
			"path": "/admin",
			"methods": ["GET","POST"],
			"description": "Admin API, reboot, update remove and modify fields, server status, etc."
		},
		"frontend" : {
			"name": "frontend",
			"enabled": true,
			"path": "/",
			"methods": ["GET","POST"],
			"description": "This module handles the frontend, login page, register, dashboard, etc."
		}
		}
	},
	"database": {
		"host": "127.0.0.1",
		"user": "",
		"password": "",
		"database": "",
		"droptables": false
	},
	"redis": {
		"host": "127.0.0.1",
		"port": "6379",
		"user": "default",
		"password": "",
		"expireTime": 300
	},
	"media" : {
		"maxMBfilesize": 100,
		"tempPath": "tmp/",
		"mediaPath": "media/",
		"notFoundFilePath" : "resources/file-not-found.webp",
		"allowPublicUploads" : true,
		"returnURL" : "",
		"transform" : {
		"media":{
			"undefined" : {
				"width" : "640",
				"height" : "480"
			},
			"image" : {
				"width" : "1280",
				"height" : "960"
			},
			"video" : {
				"width" : "720",
				"height" : "480"
			}
		},
		"avatar" : {
			"width" : "400",
			"height" : "400"
		},
		"banner" : {
			"width" : "900",
			"height" : "300"
		}
		}
	},
	"torrent": {
		"enableTorrentSeeding": false,
		"torrentPort": 6881,
		"dhtPort": 6882
	},
	"logger" :  {
		"minLevel": "5", 
		"filename": "nostrcheck-api",
		"size": "50M", 
		"interval": "60d",
		"compression": "gzip",
		"logPath": "logs/"
	},
	"session" : {
		"secret": "",
		"maxAge": 2592000000
	}
}

const localPath = "./config/local.json";


export { Modules, Module, necessaryKeys, defaultConfig, localPath}