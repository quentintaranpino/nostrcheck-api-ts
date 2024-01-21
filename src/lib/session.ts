
import session from "express-session";
import config from "config";
import crypto from 'crypto';
import { logger } from "./logger.js";
import { Application } from "express"
import { updateLocalConfigKey } from "./config.js";

declare module 'express-session' {
	interface Session {
	   pubkey: string;
	 }
}

const initSession = async (app:Application): Promise<void> => {

    //Check if session secret is insecure and generate new secret if needed
    const sessionSecret = await checkSessionSecret();

    logger.debug("Initialising session cookies");
    logger.debug("Session secret:", sessionSecret);

    //Disable secure cookie in development environment
    let secureCoockie: boolean = true
    if (config.get('environment') != "production"){
        secureCoockie = false;
    }

    app.use(session({
        secret: sessionSecret,
        proxy: true,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: secureCoockie,
            maxAge: 3600000 // Default 1 hour
        }
    }))

}

const checkSessionSecret = async(): Promise<string> => {

    if (config.get('session.secret') == "nostrcheck"){
        
        //Insecure secret, generate random secret, save to config and return with new secret
        logger.warn("Insecure session.secret detected in config file - Generating random secret");
        const newSecret = crypto.randomBytes(64).toString('hex');
        logger.info("New session.secret generated: " + newSecret);

        if (await updateLocalConfigKey("session.secret", newSecret)){
            logger.info("session.secret updated in config file");
            return newSecret;
        }

    }{
        return config.get('session.secret') ;
    }

}

export default initSession;