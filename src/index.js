const RedditPlugin = {
    async onInit(api) {
        api.log("[RedditPlugin] Initializing...");

        let currentRoomCode = null;
        let disposing = false;
        let disconnectOnLeave = true;
        let _titleDebounce = null;

        try {
            if (api.settings?.get) {
                disconnectOnLeave = (await api.settings.get("disconnectOnLeave", true)) === true;
            }
        } catch (e) {
            api.log("[RedditPlugin] Failed to read settings (non-fatal):", e);
        }

        let disposeSetting = null;
        try {
            if (api.settings?.onChange) {
                disposeSetting = api.settings.onChange(({ key, value }) => {
                    if (key === "disconnectOnLeave") {
                        disconnectOnLeave = value === true;
                        api.log(`[RedditPlugin] disconnectOnLeave=${disconnectOnLeave}`);
                    }
                });
            }
        } catch (e) {
            api.log("[RedditPlugin] Failed to subscribe to settings changes (non-fatal):", e);
        }

        function getPostId(url) {
            try {
                const u = new URL(url);
                if (!u.hostname.endsWith("reddit.com")) return null;
                const match = u.pathname.match(/^\/r\/[^/]+\/comments\/([a-zA-Z0-9]+)/i);
                return match ? match[1] : null;
            } catch (_) {}
            return null;
        }

        function cleanTitle(raw) {
            return (raw || "")
                .replace(/\s*[-–—|]\s*Reddit\s*$/i, "")
                .trim();
        }

        function emitDisconnectIfConnected(reason) {
            if (disposing) return;
            if (!currentRoomCode) return;
            const roomCode = currentRoomCode;
            currentRoomCode = null;
            api.log(`[RedditPlugin] disconnect(${roomCode}) reason=${reason}`);
            api.sendEvent("disconnect", roomCode, null);
        }

        const onNavigated = ({ url }) => {
            if (disposing) return;
            const postId = getPostId(url);

            if (postId) {
                if (currentRoomCode === postId) return;
                if (currentRoomCode) {
                    api.log(`[RedditPlugin] Switching posts: disconnecting ${currentRoomCode} before connecting ${postId}`);
                    api.sendEvent("disconnect", currentRoomCode, null);
                }
                currentRoomCode = postId;
                api.sendEvent("connect", postId, null, null);
            } else if (currentRoomCode) {
                if (!disconnectOnLeave) {
                    api.log("[RedditPlugin] Left post; disconnectOnLeave=false, staying connected.");
                    return;
                }
                emitDisconnectIfConnected("navigated-away");
            }
        };

        const onTitleChanged = ({ title, url }) => {
            if (disposing) return;
            const postId = getPostId(url);
            if (!postId || postId !== currentRoomCode) return;

            const label = cleanTitle(title);
            if (!label) return;

            clearTimeout(_titleDebounce);
            _titleDebounce = setTimeout(() => {
                if (disposing || postId !== currentRoomCode) return;
                api.log(`[RedditPlugin] title updated: "${label}"`);
                api.sendEvent("connect", postId, null, label);
            }, 500);
        };

        const onWindowClosed = () => {
            emitDisconnectIfConnected("window-closed");
            api.stop();
        };

        await api.host.browser.subscribe({ events: ["Navigated", "TitleChanged", "WindowClosed"] });

        const disposeNavigated = api.on("browser:Navigated", onNavigated);
        const disposeTitleChanged = api.on("browser:TitleChanged", onTitleChanged);
        const disposeWindowClosed = api.on("browser:WindowClosed", onWindowClosed);

        await api.host.browser.openWindow({ url: "https://www.reddit.com", title: "Reddit – Saltshaker" });
        api.log("[RedditPlugin] Reddit window opened.");

        this.onDispose = async () => {
            if (disposing) return;
            disposing = true;

            clearTimeout(_titleDebounce);

            if (currentRoomCode) {
                const roomCode = currentRoomCode;
                currentRoomCode = null;
                api.log(`[RedditPlugin] Disposing: disconnect(${roomCode})`);
                api.sendEvent("disconnect", roomCode, null);
            }

            try { disposeNavigated(); } catch (e) { api.log("[RedditPlugin] disposeNavigated error", e); }
            try { disposeTitleChanged(); } catch (e) { api.log("[RedditPlugin] disposeTitleChanged error", e); }
            try { disposeWindowClosed(); } catch (e) { api.log("[RedditPlugin] disposeWindowClosed error", e); }
            try { disposeSetting?.(); } catch (e) { api.log("[RedditPlugin] disposeSetting error", e); }

            if (api.host?.browser?.unsubscribe) {
                try {
                    await api.host.browser.unsubscribe({ events: ["Navigated", "TitleChanged", "WindowClosed"] });
                } catch (e) {
                    api.log("[RedditPlugin] browser.unsubscribe failed (non-fatal):", e);
                }
            }

            if (api.host?.browser?.closeWindow) {
                try {
                    api.host.browser.closeWindow();
                } catch (e) {
                    api.log("[RedditPlugin] closeWindow failed (non-fatal):", e);
                }
            }

            api.log("[RedditPlugin] Disposed.");
        };
    },

    async onDispose() {
        if (typeof this.onDispose === "function") return this.onDispose();
    }
};

module.exports = RedditPlugin;
