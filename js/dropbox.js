/*
 * Dropbox, spoken directly from the browser.
 *
 * The app is a static page on GitHub Pages — there is no server of ours to keep
 * a client secret in, so it uses OAuth with PKCE, which is designed for exactly
 * that situation: a proof key is generated per sign-in and never leaves the
 * device, and the app key is public by design. Nothing about your Dropbox is
 * stored anywhere but on this phone.
 *
 * Uploads always carry the `rev` of the copy we downloaded. If the workbook
 * changed in the meantime — you edited it on the laptop — Dropbox rejects the
 * write instead of silently burying your changes, and the app re-downloads and
 * replays the queue onto the new version.
 */
const AmsDropbox = (function () {
    'use strict';

    const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
    const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
    const API_URL = 'https://api.dropboxapi.com/2';
    const CONTENT_URL = 'https://content.dropboxapi.com/2';

    const KEY_APP = 'dropbox.appKey';
    const KEY_REFRESH = 'dropbox.refreshToken';
    const KEY_ACCESS = 'dropbox.accessToken';
    const KEY_EXPIRES = 'dropbox.expiresAt';
    const KEY_ACCOUNT = 'dropbox.account';
    const VERIFIER_STORE = 'ams-workout-pkce';

    /* ---------- PKCE ---------- */

    function base64Url(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function randomVerifier() {
        const bytes = new Uint8Array(64);
        crypto.getRandomValues(bytes);
        return base64Url(bytes).slice(0, 128);
    }

    async function challengeFor(verifier) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return base64Url(new Uint8Array(digest));
    }

    /* Where Dropbox sends the browser back to. Must match the redirect URI
       registered in the Dropbox App Console, exactly. */
    function redirectUri() {
        return location.origin + location.pathname.replace(/index\.html$/, '');
    }

    /* ---------- tokens ---------- */

    async function appKey() {
        return (await AmsDb.get(KEY_APP, '')) || '';
    }

    async function isConnected() {
        return !!(await AmsDb.get(KEY_REFRESH, ''));
    }

    async function account() {
        return AmsDb.get(KEY_ACCOUNT, null);
    }

    async function beginAuth() {
        const key = await appKey();
        if (!key) throw new Error('Add your Dropbox app key first.');
        const verifier = randomVerifier();
        const challenge = await challengeFor(verifier);
        const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

        // Kept in both stores: sessionStorage is the right home for it, but
        // some in-app browsers hand the redirect to a fresh session.
        const stash = JSON.stringify({ verifier, state });
        try { sessionStorage.setItem(VERIFIER_STORE, stash); } catch (err) { /* private mode */ }
        try { localStorage.setItem(VERIFIER_STORE, stash); } catch (err) { /* private mode */ }

        const params = new URLSearchParams({
            client_id: key,
            response_type: 'code',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            token_access_type: 'offline',
            redirect_uri: redirectUri(),
            state: state
        });
        location.href = AUTH_URL + '?' + params.toString();
    }

    /*
     * Called on every start-up. If Dropbox has just sent us back with a code,
     * trade it for tokens and clean the URL so a refresh does not re-run it.
     */
    async function completeAuthIfReturning() {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        const error = params.get('error');
        const state = params.get('state');

        if (!code && !error) return null;

        const clean = () => history.replaceState({}, '', redirectUri());

        if (error) {
            clean();
            throw new Error('Dropbox refused the connection: ' + (params.get('error_description') || error));
        }

        let stored = null;
        try {
            const raw = sessionStorage.getItem(VERIFIER_STORE) || localStorage.getItem(VERIFIER_STORE);
            stored = raw ? JSON.parse(raw) : null;
        } catch (err) {
            stored = null;
        }

        try { sessionStorage.removeItem(VERIFIER_STORE); } catch (err) { /* ignore */ }
        try { localStorage.removeItem(VERIFIER_STORE); } catch (err) { /* ignore */ }

        if (!stored || !stored.verifier) {
            clean();
            throw new Error('That sign-in could not be completed — please try connecting again.');
        }
        if (stored.state && state && stored.state !== state) {
            clean();
            throw new Error('That sign-in did not match the request it came from, so it was discarded.');
        }

        const key = await appKey();
        const response = await send(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: code,
                grant_type: 'authorization_code',
                client_id: key,
                code_verifier: stored.verifier,
                redirect_uri: redirectUri()
            }).toString()
        });

        clean();

        if (!response.ok) {
            throw new Error('Dropbox would not issue a token (' + response.status
                + '). Check the app key, and that the redirect URI is registered in the App Console.');
        }

        await storeTokens(await response.json());

        try {
            const who = await rpc('users/get_current_account', null);
            await AmsDb.set(KEY_ACCOUNT, {
                name: who && who.name ? who.name.display_name : '',
                email: who ? who.email : ''
            });
        } catch (err) { /* the connection works; the name is only a nicety */ }

        return true;
    }

    /* ---------- the network, defensively ---------- */

    /*
     * A phone loses signal in the middle of a request more often than a laptop
     * does, and a fetch with no timeout does not fail — it waits, for ever,
     * with the app's sync flag held and the button spinning. Every call the app
     * makes therefore carries its own clock.
     */
    const REQUEST_TIMEOUT = 45000;
    const UPLOAD_TIMEOUT = 90000;       /* a whole workbook over a bad connection */
    const MAX_BACKOFF = 10000;

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function timedFetch(url, init, timeoutMs) {
        if (typeof AbortController === 'undefined') return fetch(url, init);

        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        try {
            return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error('Dropbox did not answer within '
                    + Math.round(timeoutMs / 1000) + ' seconds. Nothing was lost — try again.');
            }
            // Offline, DNS, a captive portal: all arrive here as a TypeError.
            throw new Error('Could not reach Dropbox. Anything you have logged is still on the phone.');
        } finally {
            clearTimeout(timer);
        }
    }

    /*
     * Rate limits and server errors are the two failures worth trying again
     * for, and only briefly: the queue is safe on the phone, so a sync that
     * gives up costs nothing but a later tap. Dropbox says how long to wait
     * when it means it, and that is honoured up to a sane ceiling.
     */
    async function send(url, init, options) {
        const opts = options || {};
        const timeout = opts.timeout || REQUEST_TIMEOUT;
        const retries = opts.retries === undefined ? 1 : opts.retries;

        for (let attempt = 0; ; attempt++) {
            const response = await timedFetch(url, init, timeout);
            if (response.ok) return response;

            const worthRetrying = response.status === 429 || response.status >= 500;
            if (!worthRetrying || attempt >= retries) return response;

            const stated = Number(response.headers.get('retry-after'));
            const wait = Math.min(
                isNaN(stated) || stated <= 0 ? 1000 * (attempt + 1) : stated * 1000,
                MAX_BACKOFF);
            await sleep(wait);
        }
    }

    async function storeTokens(data) {
        if (data.refresh_token) await AmsDb.set(KEY_REFRESH, data.refresh_token);
        if (data.access_token) await AmsDb.set(KEY_ACCESS, data.access_token);
        const seconds = data.expires_in || 14400;
        await AmsDb.set(KEY_EXPIRES, Date.now() + (seconds - 120) * 1000);
    }

    /*
     * One refresh at a time. Several calls can want a token at the same moment
     * — a sync, a file list and a foreground reload all start together — and
     * three simultaneous refreshes of the same grant is a good way to have
     * Dropbox reject two of them.
     */
    let refreshing = null;

    async function accessToken() {
        const token = await AmsDb.get(KEY_ACCESS, '');
        const expires = await AmsDb.get(KEY_EXPIRES, 0);
        if (token && Date.now() < expires) return token;

        if (!refreshing) {
            refreshing = refreshAccessToken().then(
                function (value) { refreshing = null; return value; },
                function (err) { refreshing = null; throw err; });
        }
        return refreshing;
    }

    async function refreshAccessToken() {
        const refresh = await AmsDb.get(KEY_REFRESH, '');
        if (!refresh) throw new Error('Not connected to Dropbox.');

        const key = await appKey();
        const response = await send(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refresh,
                client_id: key
            }).toString()
        });

        if (!response.ok) {
            if (response.status === 400 || response.status === 401) {
                await disconnect();
                throw new Error('Dropbox has signed the app out. Connect it again in Settings.');
            }
            throw new Error('Could not refresh the Dropbox session (' + response.status + ').');
        }

        const data = await response.json();
        await storeTokens(data);
        return data.access_token;
    }

    async function disconnect() {
        await AmsDb.remove(KEY_REFRESH);
        await AmsDb.remove(KEY_ACCESS);
        await AmsDb.remove(KEY_EXPIRES);
        await AmsDb.remove(KEY_ACCOUNT);
    }

    /* ---------- requests ---------- */

    /*
     * Dropbox takes its arguments in an HTTP header, and headers may only carry
     * ASCII — so anything above 0x7e in a path (an umlaut in a folder name, say)
     * has to be escaped before it goes in.
     */
    function asciiJson(value) {
        return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (ch) {
            return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        });
    }

    async function describeError(response) {
        let detail = '';
        try {
            const text = await response.text();
            try {
                const parsed = JSON.parse(text);
                detail = parsed.error_summary || text;
            } catch (err) {
                detail = text;
            }
        } catch (err) { /* nothing more to say */ }

        let error;
        if (response.status === 401) {
            error = new Error('Dropbox rejected the session — reconnect it in Settings.');
        } else if (response.status === 429) {
            error = new Error('Dropbox is rate-limiting the app. Try again in a moment.');
        } else if (detail.indexOf('path/not_found') !== -1) {
            error = new Error('That file is no longer in Dropbox at the saved path.');
        } else if (detail.indexOf('insufficient_space') !== -1) {
            error = new Error('Your Dropbox is full, so the workbook could not be saved.');
        } else {
            error = new Error('Dropbox error (' + response.status + '): ' + (detail || 'no detail given'));
        }
        error.detail = detail;
        error.status = response.status;
        return error;
    }

    async function rpc(endpoint, args) {
        const token = await accessToken();
        const response = await send(API_URL + '/' + endpoint, {
            method: 'POST',
            headers: Object.assign(
                { Authorization: 'Bearer ' + token },
                args === null ? {} : { 'Content-Type': 'application/json' }
            ),
            body: args === null ? null : JSON.stringify(args)
        });
        if (!response.ok) throw await describeError(response);
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    /* ---------- files ---------- */

    /* Every .xlsx in the account, so a file can be picked rather than typed. */
    async function findWorkbooks(query) {
        const result = await rpc('files/search_v2', {
            query: query || 'xlsx',
            options: {
                max_results: 100,
                file_status: 'active',
                filename_only: false,
                file_extensions: ['xlsx', 'xlsm']
            }
        });

        const matches = (result && result.matches) || [];
        return matches
            .map(function (match) { return match.metadata && match.metadata.metadata; })
            .filter(function (meta) { return meta && meta['.tag'] === 'file'; })
            .map(function (meta) {
                return {
                    name: meta.name,
                    path: meta.path_lower,
                    display: meta.path_display,
                    rev: meta.rev,
                    size: meta.size,
                    modified: meta.server_modified
                };
            });
    }

    function metadata(path) {
        return rpc('files/get_metadata', { path: path });
    }

    async function download(path) {
        const token = await accessToken();
        const response = await send(CONTENT_URL + '/files/download', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token,
                'Dropbox-API-Arg': asciiJson({ path: path })
            }
        }, { timeout: UPLOAD_TIMEOUT });
        if (!response.ok) throw await describeError(response);

        const info = JSON.parse(response.headers.get('dropbox-api-result') || '{}');
        const buffer = await response.arrayBuffer();
        return {
            bytes: new Uint8Array(buffer),
            rev: info.rev,
            name: info.name,
            path: info.path_lower || path,
            modified: info.server_modified,
            size: info.size
        };
    }

    /*
     * Write the workbook back. `rev` is the version the edits were based on;
     * Dropbox refuses the write if the file has moved on since, which arrives
     * here as a conflict for the caller to resolve by re-downloading.
     */
    async function upload(path, blob, rev) {
        const token = await accessToken();
        const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'overwrite' };

        const response = await send(CONTENT_URL + '/files/upload', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': asciiJson({
                    path: path,
                    mode: mode,
                    autorename: false,
                    mute: true
                })
            },
            body: blob
        }, { timeout: UPLOAD_TIMEOUT });

        if (!response.ok) {
            const error = await describeError(response);
            if (response.status === 409 && String(error.detail || '').indexOf('conflict') !== -1) {
                const conflict = new Error('The workbook changed in Dropbox since the app last read it.');
                conflict.isConflict = true;
                throw conflict;
            }
            throw error;
        }

        return response.json();
    }

    return {
        KEY_APP: KEY_APP,
        redirectUri: redirectUri,
        appKey: appKey,
        isConnected: isConnected,
        account: account,
        beginAuth: beginAuth,
        completeAuthIfReturning: completeAuthIfReturning,
        disconnect: disconnect,
        findWorkbooks: findWorkbooks,
        metadata: metadata,
        download: download,
        upload: upload
    };
})();
