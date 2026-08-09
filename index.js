const {
    GatewayDispatchEvents
} = require('discord-api-types/v10');

const {
    ClientQuest
} = require('./utils/client');

require('dotenv').config();

let currentUserId = null;

const client =
    new ClientQuest(
        process.env.TOKEN
    );

client.once(
    GatewayDispatchEvents.Ready,
    async ({ data }) => {
        currentUserId = data.user.id;

        if (
            process.env.GITHUB_ACTIONS ===
            'true'
        ) {
            console.log(
                'Logged in!'
            );
        } else {
            console.log(
                `Logged in as @${data.user.username}`
            );
        }

        await client.fetchQuests(
            false
        );

        const questsValid =
            client.questManager
                .filterQuestsValidToDo();

        console.log(
            `Found ${questsValid.length} valid quests to do.`
        );

        for (const quest of questsValid) {
            try {
                await client.questManager.doingQuest(
                    quest
                );
            } catch (error) {
                console.error(
                    `Failed to process quest "${quest.config.messages.quest_name}":`,
                    error.message
                );
            }
        }

        console.log(
            'All quests processed. Disconnecting...'
        );

        await client.destroy();
    }
);

process.on(
    'unhandledRejection',
    (reason) => {
        console.error(
            '[Error:] Unhandled Rejection'
        );

        if (reason) {
            console.error(reason);
        }
    }
);

process.on(
    'uncaughtException',
    (error) => {
        console.error(
            'Uncaught Exception:',
            error.message
        );
    }
);

client.connect();