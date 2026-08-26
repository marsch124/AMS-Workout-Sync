/*
 * Start-up.
 *
 * Order matters here: the Dropbox redirect has to be dealt with before anything
 * tries to use the connection, and the plan is loaded after the UI exists so
 * that a slow network shows an empty screen rather than a blank one.
 */
(async function () {
    'use strict';

    /*
     * Anything that gets this far has already escaped a try/catch somewhere it
     * should not have. Silence is the worst outcome — a tap that does nothing
     * and no reason given — so it is said out loud once, and repeats are held
     * back rather than turned into a wall of toasts.
     */
    let lastComplaint = 0;

    function complain(what, err) {
        console.error(what, err);
        const now = Date.now();
        if (now - lastComplaint < 8000) return;
        lastComplaint = now;
        try {
            AmsUi.toast('Something went wrong: ' + ((err && err.message) || what), 'bad');
        } catch (ignored) { /* the UI is not up; the console has it */ }
    }

    window.addEventListener('error', (event) => complain('unexpected error', event.error || event));
    window.addEventListener('unhandledrejection', (event) => complain('unexpected error', event.reason));

    async function boot() {
        AmsUi.init();

        try {
            await AmsDb.open();
        } catch (err) {
            AmsUi.toast('This browser will not let the app store anything locally.', 'bad');
        }

        /*
         * Everything the app owns — the queue of sessions not yet written to
         * Dropbox, the connection, the cached workbook — lives in storage the
         * operating system may evict under pressure. This is the one standard
         * way to ask it not to. The answer is advisory and the request is
         * remembered by the browser, so asking on every start costs nothing;
         * a refusal is only logged, because there is nothing further to do
         * about it and a toast would be noise about a hypothetical.
         */
        try {
            if (navigator.storage && navigator.storage.persist) {
                const kept = await navigator.storage.persist();
                if (!kept) console.warn('The browser declined persistent storage; the app\'s data may be evicted under pressure.');
            }
        } catch (err) { /* an old browser without the API — nothing to ask */ }

        // The activity list is the user's own, and the extras form reads it as
        // it renders, so it has to be in place before the first paint.
        try {
            await AmsExtras.loadActivities();
        } catch (err) {
            console.warn('Falling back to the default activity list:', err);
        }

        // Coming back from the Dropbox sign-in page.
        try {
            const connected = await AmsDropbox.completeAuthIfReturning();
            if (connected) AmsUi.toast('Dropbox connected.', 'good');
        } catch (err) {
            AmsUi.toast(err.message, 'bad');
        }

        try {
            await AmsSync.load();
        } catch (err) {
            console.error(err);
            AmsUi.toast(err.message || 'The workbook could not be read.', 'bad');
        }

        AmsUi.renderToday();
        AmsUi.renderPlan();
        AmsUi.renderSettings();

        // Anything logged while offline goes up as soon as there is a network.
        window.addEventListener('online', () => {
            AmsSync.sync().then((result) => {
                if (result && result.written) {
                    AmsUi.toast(result.written + ' session'
                        + (result.written === 1 ? '' : 's') + ' written into the workbook.', 'good');
                    AmsUi.renderToday();
                }
            }).catch(() => {});
        });

        /*
         * Coming back to the app is a good moment to check the workbook again
         * — but not every time, and not every few seconds. Switching to the
         * timer app and back three times during an interval set should not be
         * three downloads of the whole workbook: that is somebody's data
         * allowance, their battery, and eventually Dropbox's rate limit.
         */
        const REFRESH_FLOOR = 60000;
        let lastRefresh = Date.now();

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastRefresh < REFRESH_FLOOR) return;
            lastRefresh = Date.now();
            AmsSync.load().catch((err) => console.warn('Refresh on foreground failed:', err));
        });
    }

    /*
     * If start-up itself fails there is no app to show a message in, so the
     * message has to be put on the page directly. A blank screen tells nobody
     * anything, least of all whether their logging is still safe.
     */
    function bootOrExplain() {
        boot().catch((err) => {
            console.error('The app could not start:', err);
            const body = document.getElementById('todayBody');
            if (!body) return;
            body.innerHTML = '<div class="empty-state"><h2>The app could not start</h2>'
                + '<p>' + String((err && err.message) || err).replace(/[<&]/g, '') + '</p>'
                + '<p>Anything you logged is still stored on this phone. Closing the app '
                + 'and opening it again is the first thing to try.</p></div>';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootOrExplain);
    } else {
        bootOrExplain();
    }

    /*
     * Offline support, and getting a new version onto the phone.
     *
     * A shipped fix is no use sitting on the server. The worker fetches
     * network-first and takes over as soon as it installs, so the only thing
     * missing was the page noticing — until it reloads it is still running
     * the code it started with, which is how a fixed screen can go on looking
     * broken.
     *
     * So: reload once when a new worker takes control. Not while a detail
     * screen is open, though — pulling the page out from under a
     * half-filled log form would lose what was typed into it.
     */
    if ('serviceWorker' in navigator) {
        let reloading = false;

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) return;
            if (document.body.classList.contains('detail-open')) {
                AmsUi.toast('A new version is ready. It will apply next time you open the app.');
                return;
            }
            reloading = true;
            location.reload();
        });

        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').then((registration) => {
                // Coming back to the app after a while is the moment worth
                // asking whether there is a newer version to have.
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        registration.update().catch(() => {});
                    }
                });
            }).catch((err) => {
                console.warn('Offline support unavailable:', err);
            });
        });
    }
})();
