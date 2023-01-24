// @deno-types="npm:@types/express@4.17.15"
import express from "npm:express@4.18.2";
import "npm:express-async-errors@3.1.1";
import multer from "npm:multer@1.4.5-lts.1";
import cors from "npm:cors@2.8.5";
import {userToAccount, tweetToToot, activityToNotification} from "./conversion.ts";
import {OAuth} from "./utils/oauth.ts";
import {addPageLinksToResponse, buildParams, injectPagingInfo} from "./utils/apiUtil.ts";
import {UserCache} from "./utils/userCache.ts";
import {CONFIG} from "./config.ts";
import {setup as setupAuthflow} from "./apis/authflow.ts";

const userCacheMap = new Map<string, UserCache>();
function getUserCache(oauth: OAuth): UserCache {
    let cache = userCacheMap.get(oauth.accessToken);
    if (cache)
        return cache;
    cache = new UserCache(oauth);
    userCacheMap.set(oauth.accessToken, cache);
    return cache;
}

const app = express();
const upload = multer();
app.use(upload.none());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use((req, res, next) => {
    // Inject query params into the body
    if (req.body === null)
        req.body = {};
    for (const [key, value] of Object.entries(req.query)) {
        req.body[key] = value;
    }

    console.log('Request to', req.url);
    console.log('body:', req.body);
    next();
});

app.get('/api/v1/instance', (req, res) => {
    res.send({
        uri: CONFIG.domain,
        title: 'Twitter',
        short_description: 'A lazy bridge to Twitter',
        description: 'A lazy bridge to Twitter',
        email: 'example@example.com',
        version: '0.0.1',
        urls: {
            streaming_api: ''
        },
        stats: {
            user_count: 1,
            status_count: 99999,
            domain_count: 1
        },
        // no thumbnail
        languages: ['en'],
        registrations: false,
        approval_required: true,
        invites_enabled: false,
        configuration: {
            accounts: {
                max_featured_tags: 0
            },
            statuses: {
                max_characters: 280,
                max_media_attachments: 4,
                characters_reserved_per_url: 23 // FIXME
            },
            polls: {
                max_options: 4,
                max_characters_per_option: 20, // FIXME
                min_expiration: 1, // FIXME
                max_expiration: 100000 // FIXME
            }
            // TODO: media_attachments
        },
        // TODO: contact_account
        rules: []
    });
});

setupAuthflow(app);
// All routes added after this will require a valid OAuth token

app.get('/api/v1/accounts/verify_credentials', async (req, res) => {
    const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/account/verify_credentials.json');
    const user = await twreq.json();

    const account = userToAccount(user);
    account.source = {
        privacy: user.protected ? 'private' : 'public',
        note: user.description
    };

    res.send(account);
});

app.get('/api/v1/timelines/home', async (req, res) => {
    const url = 'https://api.twitter.com/1.1/statuses/home_timeline.json';
    const params: Record<string, any> = buildParams(true);
    params.include_my_retweet = '1';
    injectPagingInfo(req.body, params);

    // The Mastodon API offers more flexibility in paging than Twitter does, so we need to
    // play games in order to get refreshing in Ivory to work.

    // If you reopen Ivory and there are 300 new posts, it tries to fetch them in order
    // from oldest to newest, by passing "min_id=X" where X is the most recent post it
    // saw. This doesn't work with Twitter - if we pass "since_id=X", we get the newest
    // 40 tweets.

    // Tweetbot has logic to detect this and fill the gap, but Ivory doesn't include it.
    // Thankfully, Ivory is okay with receiving more posts than it requested - so we can
    // just detect this case and do the backfilling ourselves.

    let tweets;
    if (req.body.min_id !== undefined && req.body.max_id === undefined && req.body.since_id === undefined) {
        // Ivory "get the latest posts" case detected
        tweets = [];

        const lastRead = BigInt(req.body.min_id as string);
        let maxID: BigInt | null = null;
        params.limit = '200'; // we may as well load Twitter's maximum and save on requests!
        params.min_id = lastRead - 1n; // fetch the last read tweet as well
        let done = false;

        console.log(`Tweet update request from ${lastRead} onwards`);

        while (!done) {
            let thisBatch;
            try {
                if (maxID !== null)
                    params.max_id = maxID.toString();

                const twreq = await req.oauth!.get(url, params);
                thisBatch = await twreq.json();
            } catch (ex) {
                console.error('Error while loading tweets', ex);
                break;
            }

            for (const tweet of thisBatch) {
                const id = BigInt(tweet.id_str);
                if (id <= lastRead) {
                    // We now know we have everything
                    console.log(`LastRead tweet ID seen, so we're done`);
                    done = true;
                    break;
                }

                if (maxID === null || id < maxID)
                    maxID = id - 1n;

                tweets.push(tweet);
            }

            console.log(`Loaded ${thisBatch.length} tweets (total now ${tweets.length}), new maxID=${maxID}`);

            // We requested 200 tweets, but because of filtering, we might not actually get
            // that many. So, if we got 150 or more (and we didn't see the 'last read' tweet),
            // we make another request. Otherwise, we bail.
            if (thisBatch.length < 150) {
                console.log(`Batch was under 150 tweets, so assume this is the end`);
                done = true;
            }
        }

        console.log(`Returning ${tweets.length} tweets`);
    } else {
        // Stick to the original logic
        const twreq = await req.oauth!.get(url, params);
        tweets = await twreq.json();
    }

    const toots = tweets.map(tweetToToot);
    addPageLinksToResponse(new URL(req.originalUrl, CONFIG.root), toots as {id: string}[], res);
    res.send(toots);
});

app.get('/api/v1/notifications', async (req, res) => {
    const params: Record<string, any> = buildParams(true);
    injectPagingInfo(req.body, params);

    if (req.body.types && Array.isArray(req.body.types) && req.body.types.length === 1 && req.body.types[0] === 'mention') {
        // special case for 'mentions' timeline
        const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/statuses/mentions_timeline.json', params);
        const mentions = await twreq.json();
        const notifications = [];

        for (const mention of mentions) {
            const toot = tweetToToot(mention);
            notifications.push({
                account: toot.account,
                created_at: toot.created_at,
                id: toot.id,
                status: toot,
                type: 'mention'
            });
        }

        addPageLinksToResponse(new URL(req.originalUrl, CONFIG.root), notifications as { id: string }[], res);
        res.send(notifications);
    } else {
        // fetch the full notification feed
        // no filtering yet, i should probably fix that
        params.skip_aggregation = 'true';

        const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/activity/about_me.json', params);
        const activities = await twreq.json();

        const notifications = [];
        for (const activity of activities) {
            const notification = activityToNotification(activity);
            if (notification !== null)
                notifications.push(notification);
        }

        addPageLinksToResponse(new URL(req.originalUrl, CONFIG.root), notifications as { id: string }[], res);

        res.send(notifications.filter(n => n.type !== 'invalid'));
    }
});

app.get('/api/v1/follow_requests', (req, res) => {
    res.send([]);
});
app.get('/api/v1/custom_emojis', (req, res) => {
    res.send([]);
});
app.get('/api/v1/filters', (req, res) => {
    res.send([]);
});

app.get('/api/v1/lists', async (req, res) => {
    const twreq = await req.oauth!.request(
        'GET',
        'https://api.twitter.com/1.1/lists/list.json',
        {user_id: req.oauth!.myID}
    );
    const twitterLists = await twreq.json();
    const lists = [];

    for (const twitterList of twitterLists) {
        lists.push({
            id: twitterList.id_str,
            title: twitterList.name,
            replies_policy: 'none'
        });
    }

    res.send(lists);
});

app.get('/api/v1/timelines/list/:list_id(\\d+)', async (req, res) => {
    const params: Record<string, any> = buildParams(true);
    params.list_id = req.params.list_id;
    injectPagingInfo(req.body, params);

    const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/lists/statuses.json', params);
    const tweets = await twreq.json();
    const toots = tweets.map(tweetToToot);
    res.send(toots);
});

app.get('/api/v1/accounts/:id(\\d+)', async (req, res) => {
    const userCache = getUserCache(req.oauth!);
    const user = await userCache.fetchUser(req.params.id);
    res.send(userToAccount(user));
});

app.get('/api/v1/accounts/:id(\\d+)/statuses', async (req, res) => {
    if (req.body.pinned) {
        const userCache = getUserCache(req.oauth!);
        const user = await userCache.fetchUser(req.params.id);
        const pinned = [];
        if (user.pinned_tweet_ids_str) {
            const params = buildParams(true);
            params.id = user.pinned_tweet_ids_str.join(',');
            const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/statuses/lookup.json', params);
            const map = new Map();
            for (const tweet of await twreq.json()) {
                map.set(tweet.id_str, tweet);
            }
            for (const id of user.pinned_tweet_ids_str) {
                const tweet = map.get(id);
                if (tweet !== undefined)
                    pinned.push(tweetToToot(tweet));
            }
        }
        res.send(pinned);
        return;
    }

    const params = buildParams(true);
    params.user_id = req.params.id;
    injectPagingInfo(req.body, params);

    const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/statuses/user_timeline.json', params);
    const tweets = await twreq.json();
    const toots = tweets.map(tweetToToot);
    res.send(toots);
});

app.get('/api/v1/accounts/relationships', async (req, res) => {
    const results = [];

    if (req.body.id) {
        const ids = Array.isArray(req.body.id) ? req.body.id : [req.body.id];

        if (ids.length > 1)
            console.warn(`WARNING: Got relationships query with ${ids.length} IDs`);

        for (const id of ids) {
            if (typeof id === 'string') {
                const userCache = getUserCache(req.oauth!);
                const user = await userCache.fetchUser(id);
                results.push({
                    id: user.id_str,
                    following: user.following,
                    showing_reblogs: false, // todo
                    notifying: user.notifications,
                    followed_by: user.followed_by,
                    blocking: false, // todo
                    blocked_by: false, // todo
                    muting: false,
                    muting_notifications: false,
                    requested: user.follow_request_sent,
                    domain_blocking: false,
                    endorsed: false,
                    note: ''
                });
            }
        }
    }

    res.send(results);
});

app.get('/api/v1/statuses/:id(\\d+)', async (req, res) => {
    const params = buildParams(true);
    params.id = req.params.id;
    const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/statuses/show.json', params);
    const tweet = await twreq.json();
    res.send(tweetToToot(tweet));
});

app.get('/api/v1/statuses/:id(\\d+)/context', async (req, res) => {
    const id = BigInt(req.params.id as string);

    const params = buildParams(true);
    const twreq = await req.oauth!.request('GET', `https://api.twitter.com/2/timeline/conversation/${id.toString()}.json`, params);
    const conversation = await twreq.json();

    const ancestors = [];
    const descendants = [];

    for (const obj of Object.values(conversation.globalObjects.tweets)) {
        const tweet = obj as Record<string, any>;
        const checkID = BigInt(tweet.id_str);
        if (checkID < id)
            ancestors.push(tweetToToot(tweet, conversation.globalObjects));
        else if (checkID > id)
            descendants.push(tweetToToot(tweet, conversation.globalObjects));
    }

    res.send({ ancestors, descendants });
});

app.get('/api/v2/search', async (req, res) => {
    // Ivory uses this to resolve an unknown toot
    if (req.body.limit == '1' && req.body.resolve == '1' && req.body.type === 'statuses') {
        const match = /^(.+)\/@([^/]+)\/(\d+)$/.exec(req.body.q as string);
        if (match && match[1] === CONFIG.root) {
            const params = buildParams(true);
            params.id = match[3];
            const twreq = await req.oauth!.request('GET', 'https://api.twitter.com/1.1/statuses/show.json', params);
            const tweet = await twreq.json();
            res.send({accounts: [], hashtags: [], statuses: [tweetToToot(tweet)]});
            return;
        }
    }

    res.sendStatus(404);
});

app.post('/api/v1/statuses/:id(\\d+)/favourite', async (req, res) => {
    const params = buildParams(true);
    params.id = req.params.id;
    const twreq = await req.oauth!.post('https://api.twitter.com/1.1/favorites/create.json', params);
    if (twreq.status === 200) {
        res.send(tweetToToot(await twreq.json()));
    } else {
        res.sendStatus(twreq.status);
    }
});

app.post('/api/v1/statuses/:id(\\d+)/unfavourite', async (req, res) => {
    const params = buildParams(true);
    params.id = req.params.id;
    const twreq = await req.oauth!.post('https://api.twitter.com/1.1/favorites/destroy.json', params);
    if (twreq.status === 200) {
        res.send(tweetToToot(await twreq.json()));
    } else {
        res.sendStatus(twreq.status);
    }
});

app.listen(8000);
