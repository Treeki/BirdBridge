import {OAuth} from "./oauth.ts";
import {buildParams} from "./apiUtil.ts";

enum Status {
    WAITING,
    DONE,
    FAILED
}

async function plainFetchUser(oauth: OAuth, id: string): Promise<Record<string, any>> {
    const params = buildParams(true);
    params.user_id = id;
    const twreq = await oauth.request('GET', 'https://api.twitter.com/1.1/users/show.json', params);
    return twreq.json();
}

class UserCacheEntry {
    status: Status;
    promise: Promise<Record<string, any>>;
    expiry?: number;

    constructor(id: string, promise: Promise<Record<string, any>>) {
        this.status = Status.WAITING;
        this.promise = promise;
        promise.then(_ => {
            console.log('Fetched user ID ' + id);
            this.status = Status.DONE;
            this.expiry = (new Date().getTime()) + (60 * 1000);
        }).catch(reason => {
            console.error('Failed to fetch user', reason);
            this.status = Status.FAILED;
        });
    }

    get invalid() {
        if (this.status === Status.FAILED)
            return true;
        if (this.expiry !== undefined && (new Date().getTime()) > this.expiry)
            return true;
        return false;
    }
}

export class UserCache {
    oauth: OAuth;
    map: Map<string, UserCacheEntry>;

    constructor(oauth: OAuth) {
        this.oauth = oauth;
        this.map = new Map();
    }

    fetchUser(id: string): Promise<Record<string, any>> {
        let entry = this.map.get(id);
        if (entry !== undefined && !entry.invalid) {
            console.log('Reusing user ID ' + id);
            return entry.promise;
        }

        console.log('Fetching user ID ' + id);
        const promise = plainFetchUser(this.oauth, id);
        entry = new UserCacheEntry(id, promise);
        this.map.set(id, entry);
        return promise;
    }
}
