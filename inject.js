(() => {
    'use strict';

    const originalFetch = window.fetch;
    const OriginalXHR = window.XMLHttpRequest;

    // ===== config =====
    const deadNodes = ['wolf.qqdl.site', 'vogel.qqdl.site', 'katze.qqdl.site', 'hund.qqdl.site', 'maus.qqdl.site'];
    const workingApi = 'api.monochrome.tf';

    // ===== stream queue =====
    const pending = [];
    const seen = new Set();

    function queue(url) {
        if (!url || seen.has(url)) return;
        seen.add(url);
        pending.push(url);
        console.log('🎧 captured:', url);
    }

    // Automatic tab opening removed as per user request
    /*
    function releaseOne() {
        if (pending.length) {
            const url = pending.shift();
            window.open(url, '_blank');
        }
    }

    document.addEventListener('play', releaseOne, true);
    */

    // ===== helpers =====
    function reroute(url) {
        for (const node of deadNodes) {
            if (url.includes(node)) {
                const newUrl = url.replace(node, workingApi);
                console.log(`[reroute] ${node} → ${workingApi}`);
                return newUrl;
            }
        }
        return url;
    }

    function extractRealUrl(src) {
        if (!src || typeof src !== 'string') return null;

        if (src.includes('/proxy-audio?url=')) {
            try {
                const m = src.match(/url=([^&]+)/);
                return m ? decodeURIComponent(m[1]) : null;
            } catch {}
        }

        if (src.includes('audio.tidal.com')) return src;

        return null;
    }

    function isTidal(url) {
        return url.includes('tidal.com') || url.includes('qqdl.site') || url.includes(workingApi);
    }

    // ===== GM_xmlhttpRequest Emulation via Message Passing =====
    const requestMap = new Map();
    let requestId = 0;

    window.addEventListener('TidalBypass_GM_Response', (event) => {
        // Use a defensive check for event.detail
        if (!event.detail) return;
        
        const { id, response } = event.detail;
        const callbacks = requestMap.get(id);
        if (callbacks) {
            if (response && response.success) {
                // Decode base64 back to arraybuffer
                try {
                    const binary = atob(response.data);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    
                    const res = new Response(bytes.buffer, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: new Headers({ 'Content-Type': response.contentType })
                    });
                    callbacks.resolve(res);
                } catch (e) {
                    callbacks.reject(new Error('Failed to decode response data: ' + e.message));
                }
            } else {
                callbacks.reject(new Error(response ? response.error : 'Unknown error'));
            }
            requestMap.delete(id);
        }
    });

    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            const id = requestId++;
            requestMap.set(id, { resolve, reject });
            
            // Dispatch event with a fresh object to avoid cross-context issues
            window.dispatchEvent(new CustomEvent('TidalBypass_GM_Request', {
                detail: JSON.parse(JSON.stringify({ id, data: { url, options } }))
            }));
        });
    }

    // ===== FETCH HOOK =====
    window.fetch = async (...args) => {
        let resource = args[0];
        let url = typeof resource === 'string' ? resource : resource?.url || '';

        url = reroute(url);

        const real = extractRealUrl(url);
        if (real) queue(real);

        if (isTidal(url) || real) {
            try {
                return await gmFetch(real || url, args[1]);
            } catch (err) {
                console.warn('[TidalBypass] gmFetch failed, falling back to original fetch:', err);
                return originalFetch(...args);
            }
        }

        if (url !== (typeof resource === 'string' ? resource : resource?.url)) {
            args[0] = typeof resource === 'string'
                ? url
                : new Request(url, resource);
        }

        return originalFetch(...args);
    };

    // ===== XHR HOOK =====
    window.XMLHttpRequest = function () {
        const xhr = new OriginalXHR();

        const open = xhr.open;
        xhr.open = function (method, url, ...rest) {
            url = reroute(url);

            const real = extractRealUrl(url);
            if (real) queue(real);

            this._url = url;
            return open.call(this, method, url, ...rest);
        };

        const send = xhr.send;
        xhr.send = function (body) {
            if (isTidal(this._url)) {
                gmFetch(this._url, { method: 'GET', body })
                    .then(r => r.arrayBuffer())
                    .then(buf => {
                        // Define properties to simulate a finished request
                        Object.defineProperty(this, 'response', { value: buf, writable: true });
                        Object.defineProperty(this, 'responseText', { value: new TextDecoder().decode(buf), writable: true });
                        Object.defineProperty(this, 'readyState', { value: 4, writable: true });
                        Object.defineProperty(this, 'status', { value: 200, writable: true });
                        
                        if (typeof this.onload === 'function') this.onload();
                        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
                        this.dispatchEvent(new Event('load'));
                        this.dispatchEvent(new Event('readystatechange'));
                    })
                    .catch((err) => {
                        console.warn('[TidalBypass] gmFetch (XHR) failed, falling back:', err);
                        send.call(this, body);
                    });
            } else {
                send.call(this, body);
            }
        };

        return xhr;
    };

    // ===== MEDIA SRC HOOK =====
    const originalSrc = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'src'
    );

    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set(value) {
            const real = extractRealUrl(value);

            if (real) {
                queue(real);

                gmFetch(real)
                    .then(r => r.blob())
                    .then(blob => {
                        const obj = URL.createObjectURL(blob);
                        originalSrc?.set?.call(this, obj);
                    })
                    .catch(() => originalSrc?.set?.call(this, value));
            } else {
                originalSrc?.set?.call(this, value);
            }
        },
        get() {
            return originalSrc?.get
                ? originalSrc.get.call(this)
                : this.getAttribute('src');
        }
    });

    // ===== DOWNLOAD FIX =====
    document.addEventListener('click', async (e) => {
        const a = e.target.closest('a');
        if (!a || !a.hasAttribute('download')) return;

        const href = reroute(a.getAttribute('href') || '');
        const real = extractRealUrl(href);

        if (!real) return;

        e.preventDefault();
        e.stopPropagation();

        console.log('[download] direct:', real);

        try {
            const res = await gmFetch(real);
            const blob = await res.blob();

            const obj = URL.createObjectURL(blob);
            const temp = document.createElement('a');

            temp.href = obj;
            temp.download = a.getAttribute('download') || 'track.flac';

            document.body.appendChild(temp);
            temp.click();
            document.body.removeChild(temp);

            setTimeout(() => URL.revokeObjectURL(obj), 10000);
        } catch (err) {
            console.error('download failed:', err);
        }
    }, true);

    console.log('🌊 ultimate tidal bypass extension loaded (v5.1 - fixed)');
})();
