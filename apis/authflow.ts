// @deno-types="npm:@types/express@4.17.15"
import express from "npm:express@4.18.2";
import twitter from "npm:twitter-text@3.1.0";
import {CONFIG} from "../config.ts";
import { crypto, toHashString } from "https://deno.land/std@0.173.0/crypto/mod.ts";
import * as base64 from "https://deno.land/std@0.173.0/encoding/base64.ts";
import {OAuth} from "../utils/oauth.ts";

// Add field to the Express request object
declare global {
    namespace Express {
        export interface Request {
            oauth?: OAuth
        }
    }
}

const bridgeKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(CONFIG.bridge_secret).buffer,
    {name: 'HMAC', hash: 'SHA-1'},
    false,
    ['sign', 'verify']
);

async function packObject<T>(obj: T): Promise<string> {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json).buffer;
    const signature = await crypto.subtle.sign('HMAC', bridgeKey, bytes);
    return btoa(json) + '|' + base64.encode(signature);
}

async function unpackObject<T>(str: string): Promise<T | null> {
    try {
        const bits = str.split('|');
        if (bits.length == 2) {
            const json = atob(bits[0]);
            const bytes = new TextEncoder().encode(json).buffer;
            const signature = base64.decode(bits[1]);
            if (await crypto.subtle.verify('HMAC', bridgeKey, signature, bytes)) {
                return JSON.parse(json);
            }
        }
    } catch (ex) {
        console.error('Failed to unpack signed object', ex);
    }

    return null;
}

/// Data passed in a hidden, signed field when submitting the authorisation form
interface SignInFormData {
    purpose: 'authorize',
    clientId: string,
    scope: string,
    redirectUri: string
}

/// Data passed in the 'code' field when the token is fetched by the client
interface TokenRequestData {
    purpose: 'token',
    token: string,
    tokenSecret: string,
    clientId: string,
    scope: string
}

/// Authentication token pair for Twitter, as passed by a client
interface TokenPair {
    a: string,
    s: string
}

async function makeClientSecret(clientId: string): Promise<string> {
    const data = new TextEncoder().encode(CONFIG.bridge_secret + clientId).buffer;
    const hash = await crypto.subtle.digest('SHA-1', data);
    return toHashString(hash);
}

// All these endpoints can be accessed without authentication
export function setup(app: express.Express) {
    app.post('/api/v1/apps', async (req, res) => {
        // Let the app believe that it's created something
        const client_id = btoa(req.body.client_name);
        const client_secret = await makeClientSecret(client_id);

        res.send({
            id: '123',
            name: req.body.client_name,
            website: req.body.website,
            redirect_uri: req.body.redirect_uris,
            client_id,
            client_secret,
            vapid_key: '' // some clients want this field to exist
        });
    });

    app.get('/oauth/authorize', async (req, res) => {
        if (
            typeof req.body.client_id !== 'string' ||
            typeof req.body.redirect_uri !== 'string' ||
            typeof req.body.scope !== 'string'
        ) {
            res.sendStatus(400);
            return;
        }

        const clientName = atob(req.body.client_id);
        const signedStuff = await packObject<SignInFormData>({
            purpose: 'authorize',
            clientId: req.body.client_id,
            redirectUri: req.body.redirect_uri,
            scope: req.body.scope
        });

        // Present a cool page
        res.send(`<!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-GLhlTQ8iRABdZLl6O3oVMWSktQOp6b7In1Zl3/Jr59b6EGGoI1aFkw7cmDA6j6gD" crossorigin="anonymous">
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/js/bootstrap.bundle.min.js" integrity="sha384-w76AqPfDkMBDXo30jS1Sgez6pr3x5MlQ1ZAGC+nuZB+EYdgRZgiwxhTBTkF7CXvN" crossorigin="anonymous"></script>
        </head>
        <body>
        <main class="w-100 m-auto" style="max-width: 330px">
        <form action="/oauth/authorize" method="post">
        <h1 class="h3 mb-3 fw-normal">Sign into ${twitter.htmlEscape(clientName)}</h1>
        <input type="hidden" name="stuff" value="${signedStuff}">
        <div class="mb-3">
            <label for="bridgePassword" class="form-label">Bridge password</label>
            <input type="password" class="form-control" id="bridgePassword" name="bridgePassword">
        </div>
        <div class="mb-3">
            <label for="token" class="form-label">Access token</label>
            <input type="text" class="form-control" id="token" name="token" autocomplete="off">
        </div>
        <div class="mb-3">
            <label for="tokenSecret" class="form-label">Access token secret</label>
            <input type="text" class="form-control" id="tokenSecret" name="tokenSecret" autocomplete="off">
        </div>
        <button type="submit" class="btn btn-primary">Sign in</button>
        </form>
        </main>
        </body>
        </html>`);
    });

    app.post('/oauth/authorize', async (req, res) => {
        // Verify the stuff blob
        const stuff = await unpackObject<SignInFormData>(req.body.stuff);
        if (stuff && stuff.purpose === 'authorize' && req.body.bridgePassword === CONFIG.bridge_password) {
            // All good, build another signed blob to send as the 'code'
            const signedCode = await packObject<TokenRequestData>({
                purpose: 'token',
                token: req.body.token,
                tokenSecret: req.body.tokenSecret,
                clientId: stuff.clientId,
                scope: stuff.scope
            });

            const url = new URL(stuff.redirectUri);
            url.searchParams.append('code', signedCode);
            res.redirect(url.toString());
            return;
        }

        res.sendStatus(401);
    });

    app.post('/oauth/token', async (req, res) => {
        // Verify the code blob
        if (req.body.grant_type === 'authorization_code') {
            const code = await unpackObject<TokenRequestData>(req.body.code);
            if (code && code.purpose === 'token') {
                const clientSecret = await makeClientSecret(code.clientId);
                if (code.purpose === 'token' && req.body.client_id === code.clientId && req.body.client_secret === clientSecret) {
                    // All good, create a token
                    const token = await packObject<TokenPair>({a: code.token, s: code.tokenSecret});
                    res.send({
                        'access_token': token,
                        'token_type': 'Bearer',
                        'scope': code.scope,
                        'created_at': Math.floor(new Date().getTime() / 1000)
                    });
                    return;
                }
            }
        }

        res.sendStatus(401);
    });

    // Finally, after all non-authenticated routes, we add middleware for parsing OAuth tokens
    app.use(async (req, res, next) => {
        const auth = req.get('Authorization');
        if (auth !== undefined && auth.startsWith('Bearer ')) {
            const token = await unpackObject<TokenPair>(auth.substring(7));
            if (token && token.a && token.s) {
                console.log('Successfully authenticated');
                req.oauth = new OAuth(
                    CONFIG.consumer_key,
                    CONFIG.consumer_secret,
                    token.a,
                    token.s
                );
                next();
                return;
            }
        }

        res.sendStatus(401);
    });
}
