# BirdBridge

A tiny server written using Deno and Express which allows Mastodon clients to access Twitter.

This app doesn't store any data, it just acts as a proxy that rewrites requests in cool ways.

Tested with: [Pinafore](https://pinafore.social/), [Elk](https://elk.zone/), [Ivory for iOS](https://tapbots.com/ivory/0j)

⚠️ This software is provided for educational purposes. You shouldn't actually use this to post on Twitter - after all, there are [long-standing API rules](https://twitter.com/TwitterDev/status/1615405842735714304) against third-party clients. Please don't make Elon Musk upset. :(

## Requirements

- [Deno](https://deno.land/) (developed and tested with version 1.29.4)
- A server with a SSL certificate and a subdomain
- API keys that have fallen off the back of a truck

## Acknowledgements

- Nerd verification icon (used for people who have Twitter Blue) from [@shadowbIood@twitter.com](https://twitter.com/shadowbIood/status/1590462560515473409)

## Twitter Features

| Feature                | Status | Notes                                                                                                                                       |
|------------------------|--------|---------------------------------------------------------------------------------------------------------------------------------------------|
| View Home Timeline     | ✅      |                                                                                                                                             |
| View Mentions Timeline | ✅      |                                                                                                                                             |
| View Notifications     | 🔶     | Push not supported. Notification type filters are currently ignored. Quote tweets, favs/RTs of mentions and favs/RTs of your RTs not shown. |
| View Tweet             | 🔶     | Quoted tweets in threads are incorrectly displayed as top-level members of the thread.                                                      |
| View Profile           | 🔶     | Profiles and tweets can be viewed, but following/followers lists don't work yet. "No RTs" view missing. Some profile metadata missing.      |
| View List Timeline     | ✅*     | May need pagination fixes.                                                                                                                  |
| View Lists             | ✅*     | Mastodon doesn't let you view other people's lists, so this metadata isn't exposed                                                          |
| Edit Lists             | ❌      | May be impractical                                                                                                                          |
| Create Tweets          | 🔶     | Text-only tweets and replies supported. No reply controls or scheduling yet                                                                 |
| Delete Tweets          | ✅      |                                                                                                                                             |
| Retweet                | ✅      |                                                                                                                                             |
| Fav/Like Tweets        | ✅      |                                                                                                                                             |
| View Media             | ✅      | Images, videos, fake-GIFs all supported                                                                                                     |
| Quote Tweets           | 🔶     | Quote tweets are rewritten to internal URLs (which Ivory is able to show when tapped), but something nicer would be REALLY cool...          |
| Polls                  | 🔶     | Polls can be viewed but cannot yet be created or voted on                                                                                   |
| Bookmark Tweets        | ❌      | Twitter API doesn't seem to expose bookmarked status properly                                                                               |
| Pinned Tweets          | 🔶     | Pinned tweets will appear on profiles, but you cannot pin or unpin a tweet                                                                  |
| Circle Tweets          | 🔶     | Circle tweets have a CW/spoiler attached to denote that they're special. Circle tweets cannot be posted yet                                 |
| Reply Controls         | ❌      | Not sure how to translate this to Mastodon - I'm using the toot privacy flag to denote protected accounts                                   |
| Verified Display       | ✅      | Verification status is shown as custom emoji                                                                                                |
| Follow/Unfollow        | ❌      |                                                                                                                                             |
| Block/Unblock          | ❌      | Blocks will be respected but cannot be modified yet                                                                                         |
| Disable Retweets       | ❌      | Setting respected (this is handled by Twitter's servers) but cannot be modified yet                                                         |
| Search                 | ❌      |                                                                                                                                             |
| Direct Messages        | ❌❌❌    | Mastodon's DM paradigm is just too different to ever support these, honestly                                                                |
| Follow Requests        | ❌      | Not yet sure if this would fit into Mastodon's UI cleanly                                                                                   |

## TODO

- Reorganise the codebase
- Implement more features
- Implement more Twitter Card types as Mastodon cards where I can
- Implement entities for profile descriptions (e.g. clickable @ names)
- Implement missing bits in existing features (alt text, voting in polls, etc)
- Find out why Elk is unhappy with my implementation of pagination
- Forward info about the API rate limits
- Redirect web browsers from the bridge's fake profile/tweet URLs to the real URLs on twitter.com
- Add TypeScript types for more things (Twitter API and Mastodon API entities?)
