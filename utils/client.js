const { Client } = require('@discordjs/core');
const { REST, DefaultRestOptions } = require('@discordjs/rest');
const { WebSocketManager, WebSocketShard } = require('@discordjs/ws');
const { GatewayOpcodes } = require('discord-api-types/v10');

const { QuestManager } = require('./questManager');
const { Constants } = require('./constants');
const { Utils } = require('./utils');

async function makeRequest(url, init) {
    if (init.headers) {
        init.headers = Utils.makeHeaders(init.headers);
    }

    return DefaultRestOptions.makeRequest(url, init);
}

const originalSend = WebSocketShard.prototype.send;

WebSocketShard.prototype.send = async function (payload) {
    if (payload.op === GatewayOpcodes.Identify) {
        payload.d = {
            token: payload.d.token,
            properties: {
                ...Constants.Properties,
                is_fast_connect: false,
                gateway_connect_reasons: 'AppSkeleton'
            },
            capabilities: 0,
            presence: payload.d.presence,
            compress: payload.d.compress,
            client_state: {
                guild_versions: {}
            }
        };
    }

    return originalSend.call(this, payload);
};

class ClientQuest extends Client {
    questManager = null;
    websocketManager;

    constructor(token) {
        if (!token) {
            throw new Error('Token is required to initialize the client.');
        }

        const rest = new REST({
            version: '10',
            makeRequest
        }).setToken(token);

        rest.on('rateLimited', (info) => {
            console.warn(
                `\n[RateLimit]\n` +
                `  -> Route: ${info.method} ${info.route}\n` +
                `  -> Scope: ${info.scope}${info.global ? ' (Global)' : ''}\n` +
                `  -> Limit: ${info.limit} requests\n` +
                `  -> Retry after: ${info.retryAfter}ms (${(info.retryAfter / 1000).toFixed(2)}s)\n`
            );
        });

        const gateway = new WebSocketManager({
            token,
            intents: 0,
            rest,
            readyTimeout: 120000
        });

        gateway.fetchGatewayInformation = () => {
            return Promise.resolve({
                url: 'wss://gateway.discord.gg',
                shards: 1,
                session_start_limit: {
                    total: 1000,
                    remaining: 1000,
                    reset_after: 14400000,
                    max_concurrency: 1
                }
            });
        };

        super({
            rest,
            gateway
        });

        this.websocketManager = gateway;

        gateway.on('error', () => null);
    }

    connect() {
        return Utils.updateLatestBuildVersion()
            .then(() => this.websocketManager.connect())
            .catch((e) => {
                console.error(
                    'Error during client connection:',
                    e.message
                );
            });
    }

    destroy() {
        return this.websocketManager.destroy();
    }

    fetchQuests(fetchExcludedQuests = false) {
        return this.rest
            .get('/quests/@me')
            .then((response) =>
                QuestManager.fromResponse(
                    this,
                    response,
                    fetchExcludedQuests
                )
            )
            .then((manager) => {
                this.questManager = manager;
                return manager;
            });
    }
}

module.exports = {
    ClientQuest
};