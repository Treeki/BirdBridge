export interface Config {
    headers: Record<string, string>,
    bridge_password: string,
    bridge_secret: string,
    consumer_key: string,
    consumer_secret: string,
    root: string,
    domain: string
}

export const CONFIG: Config = JSON.parse(Deno.readTextFileSync('bridge_config.json'));
