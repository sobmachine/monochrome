// Inject the main logic into the page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Handle communication between injected script and background worker
window.addEventListener('TidalBypass_GM_Request', (event) => {
    // Ensure event.detail exists and is an object
    if (!event.detail || typeof event.detail !== 'object') {
        console.error('[TidalBypass] Invalid request event detail:', event.detail);
        return;
    }

    const { id, data } = event.detail;
    
    // Check if id is present
    if (id === undefined) {
        console.error('[TidalBypass] Request missing ID');
        return;
    }

    chrome.runtime.sendMessage({ type: 'GM_xmlhttpRequest', data }, (response) => {
        // Send response back to the injected script
        window.dispatchEvent(new CustomEvent('TidalBypass_GM_Response', {
            detail: { id, response: response || { success: false, error: 'No response from background' } }
        }));
    });
});
