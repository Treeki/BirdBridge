// @deno-types="npm:@types/express@4.17.15"
import express from "npm:express@4.18.2";

export function buildParams(isTweet: boolean): Record<string, any> {
    const params: Record<string, any> = {
        include_cards: '1',
        cards_platform: 'iPhone-13',
        include_entities: '1',
        include_user_entities: '1',
        include_ext_trusted_friends_metadata: 'true',
        include_ext_verified_type: 'true',
        include_ext_vibe: 'true',
        include_ext_alt_text: 'true',
        include_composer_source: 'true',
        include_quote_count: '1',
        include_reply_count: '1',
        tweet_mode: 'extended'
    };

    return params;
}

export function injectPagingInfo(query: Record<string, any>, params: Record<string, any>) {
    if (query.limit !== undefined)
        params.count = query.limit;
    if (query.max_id !== undefined)
        params.max_id = query.max_id;
    if (query.since_id !== undefined)
        params.since_id = query.since_id;
    if (query.min_id !== undefined)
        params.since_id = query.min_id;
}

export function addPageLinksToResponse(url: URL, items: {id: string}[], response: express.Response) {
    if (items.length === 0)
        return;

    let lowestID = 99999999999999999999n;
    let highestID = 0n;
    for (const item of items) {
        const id = BigInt(item.id);
        if (id < lowestID)
            lowestID = id;
        if (id > highestID)
            highestID = id;
    }

    url.searchParams.delete('min_id');
    url.searchParams.delete('max_id');
    url.searchParams.delete('since_id');

    // the previous page represents newer content (higher IDs)
    url.searchParams.set('min_id', highestID.toString());
    const prevURL = url.toString();

    // the next page represents older content (lower IDs)
    url.searchParams.delete('min_id');
    url.searchParams.set('max_id', (lowestID - 1n).toString());
    const nextURL = url.toString();

    response.header('Link', `<${prevURL}>; rel="prev", <${nextURL}>; rel="next"`);
}
