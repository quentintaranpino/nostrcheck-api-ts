import { Application, Request, Response } from "express";
import { Event, getEventHash, nip19, validateEvent, verifySignature } from "nostr-tools";

import { logger } from "../logger";
import { VerifyResultMessage } from "../types";


export const LoadVerifyEndpoint = (app: Application): void => {
	app.post("/api/v1/verify", async (req: Request, res: Response): Promise<Response> => {
        logger.info("POST /api/v1/verify", "|", req.socket.remoteAddress);

        //Create event object
		const event: Event = {
			kind: req.body.kind,
			created_at: req.body.created_at,
			tags: req.body.tags,
			content: req.body.content,
			pubkey: req.body.pubkey,
			id: req.body.id,
			sig: req.body.sig,
		};

      // Check if event is valid
		try {
			const IsEventHashValid = getEventHash(event);
			if (IsEventHashValid != event.id) {
				const result: VerifyResultMessage = {
                    pubkey: event.pubkey,
					result: false,
					description: "Event hash is not valid",
				};

				return res.status(400).send(result);
			}

			const IsEventValid = validateEvent(event);
			const IsEventSignatureValid = verifySignature(event);
			if (!IsEventValid || !IsEventSignatureValid) {
				const result: VerifyResultMessage = {
                    pubkey: event.pubkey,
					result: false,
					description: "Event signature is not valid",
				};

				return res.status(400).send(result);
			}
		} catch (error) {
			logger.warn(`RES -> 400 Bad request - ${error}`, "|", req.socket.remoteAddress);
			const result: VerifyResultMessage = {
                pubkey: event.pubkey,
				result: false,
				description: "Malformed event",
			};

			return res.status(400).send(result);
		}

        const result: VerifyResultMessage = {
            pubkey: event.pubkey,
            result: true,
            description: "Valid Event",
        };

        return res.status(200).send(result);
    });

    }