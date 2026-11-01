// Only Giscus is replaced. Local application scripts, styles and errors stay real.
// The fixture deliberately mirrors the standard client's singleton container:
// two boards in one document would replace each other and fail our tests.
export async function mockGiscus(context, { mode = 'ready' } = {}) {
    const requests = [];
    await context.route('https://giscus.app/**', async route => {
        const url = new URL(route.request().url());
        requests.push(url.href);
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (url.pathname === '/client.js') {
            if (mode === 'blocked') return route.abort('failed');
            return route.fulfill({ status: 200, contentType: 'application/javascript', headers,
                body: `(() => {
                    const script = document.currentScript;
                    const params = new URLSearchParams(script.dataset);
                    const frame = document.createElement('iframe');
                    frame.className = 'giscus-frame';
                    frame.title = 'Comments';
                    frame.style.cssText = 'width:100%;border:0;height:220px';
                    frame.src = 'https://giscus.app/en/widget?' + params;
                    let container = document.querySelector('.giscus');
                    if (!container) {
                        container = document.createElement('div');
                        container.className = 'giscus';
                        script.after(container);
                    }
                    container.replaceChildren(frame);
                })();` });
        }
        if (url.pathname === '/en/widget') {
            const term = url.searchParams.get('term');
            const number = term === 'Shoutbox' ? 102 : 101;
            // A same-origin sibling frame must not be able to fail this board.
            const message = mode === 'missing' ? { error: 'Discussion not found' } : mode === 'error'
                ? { error: 'API rate limit exceeded' }
                : { resizeHeight: 220, discussion: { number } };
            return route.fulfill({ status: 200, contentType: 'text/html', headers,
                body: `<!doctype html><body><p>Mock discussion ${number}</p><button>Sign in with GitHub</button>
                    <script>${mode === 'silent' ? '' : `parent.postMessage({ giscus: ${JSON.stringify(message)} }, '*');`}</script>` });
        }
        // A new dependency must be mocked explicitly, never silently fetched.
        throw new Error('Unexpected Giscus resource: ' + url.href);
    });
    return requests;
}
