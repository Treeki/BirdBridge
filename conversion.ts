import twitter from "npm:twitter-text@3.1.0";
import { CONFIG } from "./config.ts";

const MONTHS: Record<string, string> = {
    'Jan': '01',
    'Feb': '02',
    'Mar': '03',
    'Apr': '04',
    'May': '05',
    'Jun': '06',
    'Jul': '07',
    'Aug': '08',
    'Sep': '09',
    'Oct': '10',
    'Nov': '11',
    'Dec': '12'
};
export function convertTimestamp(ts: string): string {
    const bits = /^... (...) (\d\d) (\d\d):(\d\d):(\d\d) \+.... (\d\d\d\d)$/.exec(ts);
    if (bits !== null) {
        const month = MONTHS[bits[1]];
        const day = bits[2];
        const hour = bits[3];
        const minute = bits[4];
        const second = bits[5];
        const year = bits[6];
        return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
    } else {
        return '1970-01-01T00:00:00.000Z';
    }
}
export function convertPollTimestamp(ts: string): string {
    return ts.substring(0, ts.length - 1) + '.000Z';
}

export function convertFormattedText(text: string, entities: Record<string, any[]>, display_text_range: [number, number]): Record<string, any> {
    // collate all entities into one list
    const list = [];
    if (entities.user_mentions) {
        for (const o of entities.user_mentions) {
            o.type = 'user_mention';
            list.push(o);
        }
    }
    if (entities.urls) {
        for (const o of entities.urls) {
            o.type = 'url';
            list.push(o);
        }
    }
    if (entities.hashtags) {
        for (const o of entities.hashtags) {
            o.type = 'hashtag';
            list.push(o);
        }
    }
    // a fake 'end' entity
    list.push({type: 'end', indices: [display_text_range[1], display_text_range[1]]});

    // add a space so that the library won't mangle the 'end' entity
    // that way, an emoji at the end of a tweet doesn't get cut off
    twitter.modifyIndicesFromUnicodeToUTF16(text + ' ', list);

    const output = [];
    const mentions = [];
    const tags = [];
    let lastPos = 0;
    let entityNum = 0;

    while (entityNum < list.length) {
        const entity = list[entityNum];
        entityNum += 1;

        if (entity.indices[0] > lastPos)
            output.push(text.substring(lastPos, entity.indices[0]));

        if (entity.type === 'user_mention') {
            const url = `${CONFIG.root}/@${entity.screen_name}`;
            mentions.push({
                id: entity.id_str,
                username: entity.screen_name,
                url,
                acct: entity.screen_name
            });
            const urlEscape = twitter.htmlEscape(url);
            const username = twitter.htmlEscape(entity.screen_name);
            output.push(`<span class="h-card"><a href="${urlEscape}" class="u-url mention" rel="nofollow noopener noreferrer" target="_blank">@<span>${username}</span></a></span>`);
        } else if (entity.type === 'url') {
            // Remap tweet URLs
            const match = /^https:\/\/twitter.com\/([^/]+)\/status\/(\d+)/.exec(entity.expanded_url);
            if (match) {
                entity.expanded_url = `${CONFIG.root}/@${match[1]}/${match[2]}`;
            }
            const url = twitter.htmlEscape(entity.expanded_url);
            const displayURL = twitter.htmlEscape(entity.display_url);
            output.push(`<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${displayURL}</a>`);
        } else if (entity.type === 'hashtag') {
            tags.push({
                name: entity.text,
                url: 'https://twitter.com/tags/' + entity.text // TODO make this better
            });
            const tag = twitter.htmlEscape(entity.text);
            output.push(`<a href="https://twitter.com/tags/${tag}" class="mention hashtag" rel="nofollow noopener noreferrer" target="_blank">#<span>${tag}</span></a>`);
        } else if (entity.type === 'end') {
            break;
        }

        lastPos = entity.indices[1];
    }

    return {
        content: output.join(''),
        mentions,
        tags
    };
}

export function userToAccount(user: Record<string, any>): Record<string, any> {
    const account: Record<string, any> = {};

    account.id = user.id_str;
    account.username = user.screen_name;
    account.acct = user.screen_name;
    account.url = 'https://twitter.com/' + user.screen_name;
    account.display_name = user.name;
    account.note = user.description;
    account.avatar = user.profile_image_url_https.replace('_normal', '');
    account.avatar_static = account.avatar;
    // TODO make this point to something useful
    // Pinafore just expects to see missing.png
    account.header = user.profile_banner_url || 'missing.png';
    account.header_static = user.profile_banner_url || 'missing.png';
    account.locked = user.protected;
    // fields, bot?
    account.created_at = convertTimestamp(user.created_at);
    if (user.status !== undefined)
        account.last_status_at = convertTimestamp(user.status.created_at);
    account.statuses_count = user.statuses_count;
    account.followers_count = user.followers_count;
    account.following_count = user.friends_count;

    return account;
}

const MEDIA_TYPES: Record<string, string> = {
    'photo': 'image',
    'video': 'video',
    'animated_gif': 'gifv'
};

export function convertMedia(media: Record<string, any>): Record<string, any> {
    const attachment: Record<string, any> = {};

    attachment.id = media.id_str;
    attachment.type = MEDIA_TYPES[media.type] || 'unknown';
    attachment.url = media.media_url_https;
    attachment.preview_url = media.media_url_https;

    if ((media.type === 'video' || media.type === 'animated_gif') && media.video_info?.variants) {
        // get the best-bitrate mp4 version
        let best = null;

        for (const variant of media.video_info.variants) {
            if (variant.content_type === 'video/mp4') {
                if (best === null || variant.bitrate > best.bitrate)
                    best = variant;
            }
        }

        if (best)
            attachment.url = best.url;
    }

    return attachment;
}

export function convertCard(card: Record<string, any>): Record<string, any> {
    const pollMatch = /^poll(\d+)choice/.exec(card.name);
    if (pollMatch) {
        const optionCount = parseInt(pollMatch[1], 10);
        const options = [];
        let totalVotes = 0;
        for (let i = 1; i <= optionCount; i++) {
            const votes = parseInt(card.binding_values[`choice${i}_count`].string_value, 10);
            options.push({
                title: card.binding_values[`choice${i}_label`].string_value,
                votes_count: votes
            });
            totalVotes += votes;
        }

        const ownVotes = [];
        if (card.binding_values.selected_choice?.string_value)
            ownVotes.push(parseInt(card.binding_values.selected_choice.string_value, 10) - 1);

        const poll = {
            id: card.url.replace(/^card:\/\//, ''),
            expires_at: convertPollTimestamp(card.binding_values.end_datetime_utc.string_value),
            expired: card.binding_values.counts_are_final.boolean_value,
            multiple: false,
            votes_count: totalVotes,
            voted: ownVotes.length > 0,
            own_votes: ownVotes,
            options,
            emojis: []
        };

        console.log(poll);
        return { poll };
    } else {
        console.warn('Unhandled card', card);
        return {};
    }
}

function convertTweetSource(source: string): Record<string, string> | null {
    const match = /<a href="(.+)" rel="nofollow">(.+)<\/a>/.exec(source);
    if (match) {
        return { name: match[2], website: match[1] };
    } else {
        return null;
    }
}

export function tweetToToot(tweet: Record<string, any>, globalObjects?: any): Record<string, any> {
    const toot: Record<string, any> = {};

    if (tweet.user === undefined && globalObjects?.users)
        tweet.user = globalObjects.users[tweet.user_id_str];

    toot.id = tweet.id_str;
    toot.uri = `https://twitter.com/${encodeURIComponent(tweet.user.screen_name)}/status/${encodeURIComponent(tweet.id_str)}`;
    toot.created_at = convertTimestamp(tweet.created_at);
    toot.account = userToAccount(tweet.user);
    toot.visibility = tweet.user.protected ? 'private' : 'public';
    toot.sensitive = false;
    toot.spoiler_text = '';
    toot.media_attachments = [];
    toot.application = convertTweetSource(tweet.source);
    if (tweet.retweeted_status !== undefined) {
        toot.reblog = tweetToToot(tweet.retweeted_status);
        toot.in_reply_to_id = null;
        toot.in_reply_to_account_id = null;
        toot.language = null;
        toot.url = null;
        toot.replies_count = 0;
        toot.reblogs_count = 0;
        toot.favourites_count = 0;
        toot.content = '';
        toot.text = '';
    } else {
        toot.reblog = null;
        toot.in_reply_to_id = tweet.in_reply_to_status_id_str;
        toot.in_reply_to_account_id = tweet.in_reply_to_user_id_str;
        toot.language = tweet.lang;
        toot.url = toot.uri;
        toot.replies_count = tweet.reply_count;
        toot.reblogs_count = tweet.retweet_count;
        toot.favourites_count = tweet.favorite_count;
        const conv = convertFormattedText(tweet.full_text, tweet.entities, tweet.display_text_range);
        toot.content = conv.content;
        toot.mentions = conv.mentions;
        toot.tags = conv.tags;
        toot.text = tweet.full_text;
        if (tweet?.extended_entities?.media) {
            toot.media_attachments = tweet.extended_entities.media.map(convertMedia);
        }

        // append quoted tweets, in lieu of a better option
        if (tweet.is_quote_status && tweet.quoted_status_permalink) {
            let quote = tweet.quoted_status_permalink;
            const match = /^https:\/\/twitter.com\/([^/]+)\/status\/(\d+)/.exec(quote.expanded);
            if (match) {
                quote.expanded = `${CONFIG.root}/@${match[1]}/${match[2]}`;
            }
            const url = twitter.htmlEscape(quote.expanded);
            const displayURL = twitter.htmlEscape(quote.display);
            toot.content = toot.content + ` <a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${displayURL}</a>`;
        }
    }
    // poll, card...
    toot.favourited = tweet.favorited;
    toot.reblogged = tweet.retweeted;

    if (tweet.card) {
        const conv = convertCard(tweet.card);
        if (conv.poll)
            toot.poll = conv.poll;
    }

    if (tweet.limited_actions === 'limit_trusted_friends_tweet') {
        const whomst = tweet.ext_trusted_friends_metadata?.metadata?.owner_screen_name || '???';
        toot.spoiler_text = `🔵 ${whomst}'s circle`;
    }

    return toot;
}

export function activityToNotification(activity: Record<string, any>): Record<string, any> | null {
    const note: Record<string, any> = {};

    note.id = activity.max_position;
    note.created_at = convertTimestamp(activity.created_at);
    if (activity.action === 'favorite') {
        note.type = 'favourite';
        note.status = tweetToToot(activity.targets[0]);
        note.account = userToAccount(activity.sources[0]);
    } else if (activity.action === 'reply') {
        note.type = 'mention';
        note.status = tweetToToot(activity.targets[0]);
        note.account = userToAccount(activity.sources[0]);
    } else if (activity.action === 'mention') {
        note.type = 'mention';
        note.status = tweetToToot(activity.target_objects[0]);
        note.account = userToAccount(activity.sources[0]);
    } else if (activity.action === 'retweet') {
        note.type = 'reblog';
        note.status = tweetToToot(activity.targets[0]);
        note.account = userToAccount(activity.sources[0]);
    } else if (activity.action === 'follow') {
        note.type = 'follow';
        note.account = userToAccount(activity.sources[0]);
    } else {
        console.warn('unhandled activity', activity);
        note.type = 'invalid';
        return note;
    }

    return note;
}
