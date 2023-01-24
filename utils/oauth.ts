import { crypto, toHashString } from "https://deno.land/std@0.173.0/crypto/mod.ts";
import {CONFIG} from "../config.ts";

function percentEncode(s: string): string {
    return encodeURIComponent(s).replace(/['()*!]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function buildHmacKey(consumerSecret: string, accessTokenSecret: string): Promise<CryptoKey> {
    const string = percentEncode(consumerSecret) + '&' + percentEncode(accessTokenSecret);
    const buffer = new TextEncoder().encode(string).buffer;
    return crypto.subtle.importKey('raw', buffer, {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
}

async function makeSignature(hmacKey: CryptoKey, oauthParams: Record<string, string>, method: string, url: string|URL, params: URLSearchParams|null): Promise<string> {
    const paramBits = [];

    for (const [key, value] of Object.entries(oauthParams)) {
        paramBits.push(`${percentEncode(key)}=${percentEncode(value)}`);
    }

    if (typeof url === 'string') {
        url = new URL(url);
    }
    url.searchParams.forEach((value, key) => {
        paramBits.push(`${percentEncode(key)}=${percentEncode(value)}`);
    });

    if (params !== null) {
        for (const [key, value] of Object.entries(params)) {
            paramBits.push(`${percentEncode(key)}=${percentEncode(value)}`);
        }
    }

    const parameterString = percentEncode(paramBits.sort().join('&'));
    const urlBase = percentEncode(url.origin + url.pathname);
    const baseString = `${method.toUpperCase()}&${urlBase}&${parameterString}`;
    const baseArray = new TextEncoder().encode(baseString);
    const hash = await crypto.subtle.sign('HMAC', hmacKey, baseArray.buffer);
    return toHashString(hash, 'base64');
}

export class OAuth {
    consumerKey: string;
    consumerSecret: string;
    accessToken: string;
    accessTokenSecret: string;
    myID: string;
    key?: CryptoKey;

    constructor(consumerKey: string, consumerSecret: string, accessToken: string, accessTokenSecret: string) {
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        this.accessToken = accessToken;
        this.accessTokenSecret = accessTokenSecret;
        this.myID = accessToken.substring(0, accessToken.indexOf('-'));
    }

    async request(method: string, url: string|URL, queryParams?: Record<string, string>, bodyParams?: Record<string, string> | null): Promise<Response> {
        if (this.key === undefined) {
            this.key = await buildHmacKey(this.consumerSecret, this.accessTokenSecret);
        }

        const oauthParams: Record<string, string> = {
            oauth_consumer_key: this.consumerKey,
            oauth_nonce: crypto.randomUUID().toUpperCase(),
            oauth_signature_method: 'HMAC-SHA1',
            oauth_timestamp: Math.floor(new Date().getTime() / 1000).toString(),
            oauth_token: this.accessToken,
            oauth_version: '1.0'
        };

        url = new URL(url);
        if (queryParams !== undefined) {
            for (const [key, value] of Object.entries(queryParams)) {
                url.searchParams.append(key, value);
            }
        }

        let body = null;
        if (bodyParams !== undefined && bodyParams !== null) {
            body = new URLSearchParams(bodyParams);
        }

        oauthParams['oauth_signature'] = await makeSignature(this.key, oauthParams, method, url, body);

        const oauthBits = [];
        for (const [key, value] of Object.entries(oauthParams)) {
            oauthBits.push(`${percentEncode(key)}="${percentEncode(value)}"`);
        }

        const headers: Record<string, string> = { ...CONFIG.headers };
        headers['Authorization'] = 'OAuth ' + oauthBits.join(', ');

        return fetch(url, { body, headers, method });
    }

    get(url: string|URL, queryParams?: Record<string, string>, bodyParams?: Record<string, string> | null): Promise<Response> {
        return this.request('GET', url, queryParams, bodyParams);
    }
    post(url: string|URL, queryParams?: Record<string, string>, bodyParams?: Record<string, string> | null): Promise<Response> {
        return this.request('POST', url, queryParams, bodyParams);
    }

    /*async postGraphQL(key: string, variables: Record<string, any>, features?: Record<string, any>): Promise<Response> {

    }*/
}
