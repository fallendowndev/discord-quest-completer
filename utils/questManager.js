const { Quest } = require('./quest');
const { Utils } = require('./utils');

class QuestManager {
    constructor(client, quests = []) {
        this.quests = new Map();
        this.client = client;
        this.activeTimers = [];

        quests.forEach((quest) => {
            this.quests.set(quest.id, quest);
        });
    }

    static async fromResponse(
        client,
        response,
        fetchExcludedQuests = false
    ) {
        if (response.quest_enrollment_blocked_until !== null) {
            throw new Error(
                `Quest enrollment is blocked until ${response.quest_enrollment_blocked_until}.`
            );
        }

        const questManager = new QuestManager(
            client,
            response.quests.map((quest) =>
                Quest.create(quest)
            )
        );

        if (fetchExcludedQuests) {
            for (const quest of response.excluded_quests) {
                if (quest.id) {
                    await questManager.addExcludedQuest(
                        quest.id
                    );
                }
            }
        }

        return questManager;
    }

    async addExcludedQuest(questId) {
        try {
            const response =
                await this.client.rest.get(
                    `/quests/${questId}`
                );

            const quest = Quest.create({
                id: questId,
                config: response,
                user_status: null,
                targeted_content: 0,
                preview: false
            });

            console.log(
                `Added excluded quest "${quest.config.messages.quest_name}" to the quest manager.`
            );

            this.quests.set(
                quest.id,
                quest
            );
        } catch (err) {
            console.error(
                `Failed to fetch excluded quest "${questId}".`,
                err.message
            );
        }
    }

    [Symbol.iterator]() {
        return this.quests.values();
    }

    get size() {
        return this.quests.size;
    }

    list() {
        return Array.from(
            this.quests.values()
        );
    }

    get(id) {
        return this.quests.get(id);
    }

    upsert(quest) {
        this.quests.set(
            quest.id,
            quest
        );
    }

    remove(id) {
        return this.quests.delete(id);
    }

    clear() {
        this.quests.clear();
    }

    getExpired(date = new Date()) {
        return this.list().filter(
            (quest) =>
                quest.isExpired(date)
        );
    }

    getCompleted() {
        return this.list().filter(
            (quest) =>
                quest.isCompleted()
        );
    }

    getClaimable() {
        return this.list().filter(
            (quest) =>
                quest.isCompleted() &&
                !quest.hasClaimedRewards()
        );
    }

    hasQuest(id) {
        return this.quests.has(id);
    }

    filterQuestsValidToDo() {
        return this.list().filter(
            (quest) =>
                !quest.isCompleted() &&
                !quest.isExpired()
        );
    }

    filterQuestsValidToRedeem() {
        return this.list().filter(
            (quest) =>
                quest.isCompleted() &&
                !quest.hasClaimedRewards()
        );
    }

    getApplicationData(ids) {
        const query =
            new URLSearchParams();

        ids.forEach((id) => {
            query.append(
                'application_ids',
                id
            );
        });

        return this.client.rest.get(
            '/applications/public',
            {
                query
            }
        );
    }

    acceptQuest(
        quest,
        isAndroid = false
    ) {
        return this.client.rest
            .post(
                `/quests/${quest.id}/enroll`,
                {
                    body: {
                        location:
                            isAndroid
                                ? 12
                                : 11,
                        is_targeted: false,
                        metadata_sealed: null,
                        traffic_metadata_raw:
                            quest.raw
                                .traffic_metadata_raw,
                        traffic_metadata_sealed:
                            quest.raw
                                .traffic_metadata_sealed
                    },
                    headers: {
                        AndroidRequest:
                            isAndroid
                                ? 'true'
                                : 'false'
                    }
                }
            )
            .then((response) => {
                const questData =
                    this.get(quest.id);

                if (questData) {
                    questData.updateUserStatus(
                        response
                    );
                }

                return questData;
            });
    }

    timeout(ms) {
        return new Promise(
            (resolve) => {
                const timerId = setTimeout(
                    resolve,
                    ms
                );
                this.activeTimers.push(timerId);
            }
        );
    }

    clearAllTimers() {
        this.activeTimers.forEach((timerId) => {
            clearTimeout(timerId);
        });
        this.activeTimers = [];
    }

    async doingQuest(quest) {
        this.clearAllTimers();

        const questName =
            quest.config.messages
                .quest_name;

        const isAndroid =
            Boolean(
                quest.config
                    .task_config_v2
                    .tasks
                    .WATCH_VIDEO_ON_MOBILE
            ) &&
            !Boolean(
                quest.config
                    .task_config_v2
                    .tasks
                    .WATCH_VIDEO
            );

        if (!quest.isEnrolledQuest()) {
            console.log(
                `Enrolled: ${questName}`
            );

            try {
                await this.acceptQuest(
                    quest,
                    isAndroid
                );
            } catch (err) {
                console.error(
                    `Failed to enroll in quest "${questName}".`,
                    err?.message
                );

                return;
            }
        } else {
            console.log(
                `Enrolled: ${questName}`
            );
        }

        console.log(
            `Started: ${questName}`
        );

        const applicationName =
            quest.config.application.name;

        const taskConfig =
            quest.config.task_config_v2;

        const taskNames = [
            'WATCH_VIDEO',
            'PLAY_ON_DESKTOP',
            'PLAY_ON_XBOX',
            'PLAY_ON_PLAYSTATION',
            'STREAM_ON_DESKTOP',
            'PLAY_ACTIVITY',
            'WATCH_VIDEO_ON_MOBILE',
            'ACHIEVEMENT_IN_ACTIVITY'
        ];

        const taskName =
            taskNames.find(
                (name) =>
                    taskConfig.tasks[name] != null
            );

        if (!taskName) {
            console.log(
                'Unknown quest type. Use the Discord desktop app to complete the',
                questName,
                'quest!'
            );

            return;
        }

        const secondsNeeded =
            taskConfig.tasks[
                taskName
            ].target;

        const secondsDone =
            quest.userStatus
                ?.progress
                ?.[taskName]
                ?.value ?? 0;

        switch (taskName) {
            case 'WATCH_VIDEO':
            case 'WATCH_VIDEO_ON_MOBILE':
                await this.doingWatchVideoQuest(
                    quest,
                    questName,
                    secondsNeeded,
                    secondsDone
                );
                break;

            case 'PLAY_ON_XBOX':
            case 'PLAY_ON_PLAYSTATION':
            case 'PLAY_ON_DESKTOP':
                await this.doingPlayOnPlatformQuest(
                    quest,
                    questName,
                    secondsNeeded,
                    taskName,
                    applicationName
                );
                break;

            case 'PLAY_ACTIVITY':
                await this.doingPlayActivityQuest(
                    quest,
                    questName,
                    secondsNeeded,
                    taskName,
                    applicationName
                );
                break;

            case 'STREAM_ON_DESKTOP':
                console.log(
                    'This no longer works in node for non-video quests. Use the Discord desktop app to complete the',
                    questName,
                    'quest!'
                );
                break;

            case 'ACHIEVEMENT_IN_ACTIVITY':
                await this.doingAchievementInActivityQuest(
                    quest,
                    questName
                );
                break;
        }
    }

    async doingWatchVideoQuest(
        quest,
        questName,
        secondsNeeded,
        secondsDone
    ) {
        const maxFuture = 10;
        const speed = 14;
        const progressInterval = 60;

        const enrolledAt =
            new Date(
                quest.userStatus
                    ?.enrolled_at
            ).getTime();

        let completed = false;
        let lastProgressUpdate = 0;

        try {
            while (true) {
                const maxAllowed =
                    Math.floor(
                        (Date.now() -
                            enrolledAt) /
                            1000
                    ) + maxFuture;

                const diff =
                    maxAllowed - secondsDone;

                const timestamp =
                    secondsDone + speed;

                if (diff >= speed) {
                    const response =
                        await this.client.rest.post(
                            `/quests/${quest.id}/video-progress`,
                            {
                                body: {
                                    timestamp:
                                        Math.min(
                                            secondsNeeded,
                                            timestamp +
                                                Math.random()
                                        )
                                }
                            }
                        );

                    completed =
                        response.completed_at != null;

                    secondsDone =
                        Math.min(
                            secondsNeeded,
                            timestamp
                        );
                }

                const currentTime = Date.now();
                if (currentTime - lastProgressUpdate >= progressInterval * 1000 || secondsDone >= secondsNeeded) {
                    const progress = Math.floor(secondsDone);
                    const remainingSeconds = Math.max(0, secondsNeeded - secondsDone);
                    const remainingMinutes = Math.ceil(remainingSeconds / 60);
                    
                    console.log(
                        `Progress: ${progress}/${secondsNeeded} — ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} remaining`
                    );
                    
                    lastProgressUpdate = currentTime;
                }

                if (
                    timestamp >=
                    secondsNeeded
                ) {
                    break;
                }

                await this.timeout(
                    speed * 1000
                );
            }

            if (!completed) {
                await this.client.rest.post(
                    `/quests/${quest.id}/video-progress`,
                    {
                        body: {
                            timestamp:
                                secondsNeeded
                        }
                    }
                );
            }

            console.log(
                `${questName} Completed!`
            );
        } catch (error) {
            console.error(
                `Error during quest "${questName}":`,
                error.message
            );
            throw error;
        } finally {
            this.clearAllTimers();
        }
    }

    async doingPlayOnPlatformQuest(
        quest,
        questName,
        secondsNeeded,
        taskName,
        applicationName
    ) {
        const progressInterval = 60;
        let lastProgressUpdate = 0;

        try {
            while (!quest.isCompleted()) {
                const secondsDone =
                    quest.userStatus
                        ?.progress
                        ?.[taskName]
                        ?.value || 0;

                const response =
                    await this.client.rest.post(
                        `/quests/${quest.id}/heartbeat`,
                        {
                            body: {
                                application_id:
                                    quest.config
                                        .application
                                        .id,
                                terminal: false
                            }
                        }
                    );

                quest.updateUserStatus(
                    response
                );

                const currentTime = Date.now();
                if (currentTime - lastProgressUpdate >= progressInterval * 1000 || secondsDone >= secondsNeeded) {
                    const progress = Math.floor(secondsDone);
                    const remainingSeconds = Math.max(0, secondsNeeded - secondsDone);
                    const remainingMinutes = Math.ceil(remainingSeconds / 60);
                    
                    console.log(
                        `Progress: ${progress}/${secondsNeeded} — ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} remaining`
                    );
                    
                    lastProgressUpdate = currentTime;
                }

                await this.timeout(
                    10 * 1000
                );
            }

            const response =
                await this.client.rest.post(
                    `/quests/${quest.id}/heartbeat`,
                    {
                        body: {
                            application_id:
                                quest.config
                                    .application
                                    .id,
                            terminal: true
                        }
                    }
                );

            quest.updateUserStatus(
                response
            );

            console.log(
                `${questName} Completed!`
            );
        } catch (error) {
            console.error(
                `Error during quest "${questName}":`,
                error.message
            );
            throw error;
        } finally {
            this.clearAllTimers();
        }
    }

    async doingPlayActivityQuest(
        quest,
        questName,
        secondsNeeded,
        taskName,
        applicationName
    ) {
        const progressInterval = 60;
        const streamKey = 'call:1:1';
        let lastProgressUpdate = 0;

        try {
            while (!quest.isCompleted()) {
                const secondsDone =
                    quest.userStatus
                        ?.progress
                        ?.[taskName]
                        ?.value || 0;

                const response =
                    await this.client.rest.post(
                        `/quests/${quest.id}/heartbeat`,
                        {
                            body: {
                                stream_key:
                                    streamKey,
                                terminal: false
                            }
                        }
                    );

                quest.updateUserStatus(
                    response
                );

                const currentTime = Date.now();
                if (currentTime - lastProgressUpdate >= progressInterval * 1000 || secondsDone >= secondsNeeded) {
                    const progress = Math.floor(secondsDone);
                    const remainingSeconds = Math.max(0, secondsNeeded - secondsDone);
                    const remainingMinutes = Math.ceil(remainingSeconds / 60);
                    
                    console.log(
                        `Progress: ${progress}/${secondsNeeded} — ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} remaining`
                    );
                    
                    lastProgressUpdate = currentTime;
                }

                await this.timeout(
                    10 * 1000
                );
            }

            const response =
                await this.client.rest.post(
                    `/quests/${quest.id}/heartbeat`,
                    {
                        body: {
                            stream_key:
                                streamKey,
                            terminal: true
                        }
                    }
                );

            quest.updateUserStatus(
                response
            );

            console.log(
                `${questName} Completed!`
            );
        } catch (error) {
            console.error(
                `Error during quest "${questName}":`,
                error.message
            );
            throw error;
        } finally {
            this.clearAllTimers();
        }
    }

    async doingAchievementInActivityQuest(
        quest,
        questName
    ) {
        const applicationId =
            quest.config
                .application.id;

        const applicationName =
            quest.config
                .application.name;

        const questTarget =
            quest.config
                .task_config_v2
                .tasks
                .ACHIEVEMENT_IN_ACTIVITY
                .target;

        try {
            const query =
                new URLSearchParams({
                    response_type: 'code',
                    client_id: applicationId,
                    scope:
                        'identify applications.commands applications.entitlements',
                    state: ''
                });

            const response =
                await this.client.rest.post(
                    '/oauth2/authorize',
                    {
                        query,
                        body: {
                            permissions: '0',
                            authorize: true,
                            integration_type: 1,
                            location_context: {
                                guild_id: '10000',
                                channel_id: '10000',
                                channel_type: 10000
                            }
                        }
                    }
                );

            console.log(
                `Authorized application ${applicationName}`
            );

            const location =
                response?.location;

            let authCode = null;

            if (location) {
                authCode =
                    new URL(location)
                        .searchParams
                        .get('code');
            }

            if (!authCode) {
                console.error(
                    `No auth code received for application ${applicationName}. Cannot complete the quest.`
                );

                return;
            }

            const {
                token,
                error: authError,
                activityReferrer
            } =
                await Utils.authorizeDiscordSays(
                    applicationId,
                    quest.id,
                    authCode,
                    this.client
                );

            if (
                authError ||
                !token
            ) {
                console.error(
                    `Failed to authorize with Discord Says for application ${applicationName}. Cannot complete the quest.`,
                    authError
                );

                return;
            }

            const {
                success,
                error: progressError
            } =
                await Utils.progressDiscordSays(
                    applicationId,
                    quest.id,
                    token,
                    questTarget,
                    activityReferrer
                );

            if (
                progressError ||
                !success
            ) {
                console.error(
                    `Failed to progress quest with Discord Says for application ${applicationName}. Cannot complete the quest.`,
                    progressError
                );

                return;
            }

            const tokens =
                await this.client.rest.get(
                    '/oauth2/tokens'
                );

            const tokenInfo =
                tokens.find(
                    (token) =>
                        token.application?.id ===
                        applicationId
                );

            if (tokenInfo) {
                try {
                    await this.client.rest.delete(
                        `/oauth2/tokens/${tokenInfo.id}`
                    );

                    console.log(
                        `Deauthorized application ${applicationName}`
                    );
                } catch (err) {
                    console.error(
                        `Failed to deauthorize token for application ${applicationName}.`,
                        err.message
                    );
                }
            }

            console.log(
                `${questName} Completed!`
            );
        } catch (error) {
            console.error(
                `Error during quest "${questName}":`,
                error.message
            );
            throw error;
        } finally {
            this.clearAllTimers();
        }
    }
}

module.exports = {
    QuestManager
};