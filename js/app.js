/*
 * Start-up.
 *
 * Order matters here: the Dropbox redirect has to be dealt with before anything
 * tries to use the connection, and the plan is loaded after the UI exists so
 * that a slow network shows an empty screen rather than a blank one.
 */
(async function () {
    'use strict';

    async function boot() {
        AmsUi.init();

        try {
            await AmsDb.open();
        } catch (err) {
            AmsUi.toast('This browser will not let the app store anything locally.', 'bad');
        }

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

        // Coming back to the app is a good moment to check the workbook again.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                AmsSync.load().catch(() => {});
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
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
