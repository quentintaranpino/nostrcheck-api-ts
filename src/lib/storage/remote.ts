import fs from 'fs';
import { S3Client, S3ClientConfig, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ProcessingFileData, mime_conversion } from '../../interfaces/media.js';
import { logger } from '../logger.js';
import app from '../../app.js';

const s3Config: S3ClientConfig = {

  endpoint: app.get("config.storage")["remote"]["endpoint"] ,
  credentials: {
    accessKeyId: app.get("config.storage")["remote"]["accessKeyId"],
    secretAccessKey: app.get("config.storage")["remote"]["secretAccessKey"],
  },
  region: app.get("config.storage")["remote"]["region"],
  forcePathStyle: app.get("config.storage")["remote"]["s3ForcePathStyle"],
};

const s3Client = new S3Client(s3Config);

const saveR2File = async (filePath: string, filedata:ProcessingFileData): Promise<boolean> => {

  const bucketName :string = app.get("config.storage")["remote"]["bucketName"];

  const params = {
    Bucket: bucketName,
    Key: filedata.filename,
    Body: fs.readFileSync(filePath),
    ContentType : mime_conversion[filedata.originalmime],
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    const fileUrl = `${app.get("config.storage")["remote"]["endpoint"]}/${params.Bucket}/${params.Key}`;
    logger.info(`Successfully uploaded file to ${fileUrl}`);
    return true;
  } catch (error) {
      logger.error(`Error uploading file: ${error}`);
  }

  return false;
}

const getR2File = async (filename: string): Promise<string> => {
  
    const bucketName :string = app.get("config.storage")["remote"]["bucketName"];
  
    const params = new GetObjectCommand({
      Bucket: bucketName,
      Key: filename,
    });
  
    try {
      const url = await getSignedUrl(s3Client, params, { expiresIn: 60 });
      return url;
    } catch (error) {
      logger.error(`Error generating signed URL: ${error}`);
    }
  
    return "";
}

const deleteR2File = async (filename: string): Promise<boolean> => {
    
      const bucketName :string = app.get("config.storage")["remote"]["bucketName"];
    
      const params = {
        Bucket: bucketName,
        Key: filename,
      };
    
      try {
        await s3Client.send(new DeleteObjectCommand(params));
        return true;
      } catch (error) {
        logger.error(`Error deleting file: ${error}`);
      }
    
      return false;
  }

export { saveR2File, getR2File, deleteR2File };