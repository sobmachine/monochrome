chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GM_xmlhttpRequest') {
        const { url, options } = request.data;
        
        fetch(url, {
            method: options.method || 'GET',
            headers: {
                ...options.headers,
                'Origin': 'https://listen.tidal.com',
                'Referer': 'https://listen.tidal.com/'
            },
            body: options.body || null
        })
        .then(async response => {
            const buffer = await response.arrayBuffer();
            // Convert buffer to base64 for message passing
            const uint8 = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < uint8.byteLength; i++) {
                binary += String.fromCharCode(uint8[i]);
            }
            const base64 = btoa(binary);
            
            sendResponse({
                success: true,
                status: response.status,
                statusText: response.statusText,
                data: base64,
                contentType: response.headers.get('content-type')
            });
        })
        .catch(error => {
            sendResponse({
                success: false,
                error: error.message
            });
        });
        
        return true; // Keep message channel open for async response
    }
});
