import {request as undicireq} from "undici";
import {Cookie,CookieJar} from "tough-cookie";
import {createBrotliDecompress,createInflate,createGunzip} from "node:zlib";

class StatusCodeError extends Error {
    constructor(message, statusCode) {
        super(message);
        this["name"] = this.constructor.name;
        this["statusCode"] = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Helper function for async delay
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class BROWSE {
    constructor(options={}) {
        this.cookiejar = new CookieJar();
        this.maxRedirections = options.maxRedirections || 5;
        this.redirectcount = 0;
        this.maxRetries = options.maxRetries || 5; // Increased from 3 to 5 for better reliability
        this.initialBackoffMs = options.initialBackoffMs || 300; // Decreased from 500 to 300 for faster retry
        this.timeout = options.timeout || 15000; // 15 seconds timeout
    }

    async getcookies(url,headers) {
        const cookies = await this.cookiejar.getCookies(url);
        if (cookies && cookies.length) {
            headers["Cookie"] = cookies.map(cookie => cookie.cookieString()).join(';');
        }
    }

    async setcookies(url, headers) {
        if (headers && Object.prototype.hasOwnProperty.call(headers,"set-cookie")) {
            const cookies = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"].map(Cookie.parse) : [Cookie.parse(headers["set-cookie"])];
            for (let cookie of cookies){
                this.cookiejar.setCookie(cookie, url);
            };
        };
    }

    async converttobuffer(body){
        let data = [];
        for await (const chunk of body){
            data.push(chunk);
        }
        return Buffer.concat(data);
    }

    async handlebody(headers,body){
        if (headers && Object.prototype.hasOwnProperty.call(headers, "content-encoding") && ['gzip', 'deflate', 'br'].includes(headers['content-encoding'])){
            if (headers["content-encoding"] === "br") {
                return body.pipe(createBrotliDecompress());
            } else if (headers["content-encoding"] === "gzip") {
                return body.pipe(createGunzip());
            } else if (headers["content-encoding"] === "deflate") {
                return body.pipe(createInflate());
            }
        }
        return body;
    }

    async request(url,options={}) {
        if (!Object.prototype.hasOwnProperty.call(options, "headers")) {
            options.headers = {};
        }
        options.headers["Host"] = new URL(url).hostname;
        await this.getcookies(url,options.headers);
        if (Object.prototype.hasOwnProperty.call(options.headers,"Content-Type") && Object.prototype.hasOwnProperty.call(options,"body") && typeof options.body === "object"){
            if (options.headers["Content-Type"].startsWith("application/json")){
                options.body = JSON.stringify(options.body);
            }
            else if (options.headers["Content-Type"].startsWith("application/x-www-form-urlencoded")){
                options.body = new URLSearchParams(options.body).toString();
            }
        }
        if (Object.prototype.hasOwnProperty.call(options,"body")){
            options.headers["Content-Length"] = Buffer.byteLength(options.body);
        }

        // Add timeout to all requests
        options.bodyTimeout = this.timeout;
        options.headersTimeout = this.timeout;

        let retries = 0;
        let currentDelay = this.initialBackoffMs;

        while (true) { // Loop for retries
            try {
                const {statusCode, headers, body} = await undicireq(url, options);
                await this.setcookies(url,headers);

                // Handle redirects
                if (headers && headers.location && this.redirectcount <= this.maxRedirections){
                    const autoredirect = options.autoredirect || false;
                    if(autoredirect){
                        this.redirectcount++;
                        const newUrl = headers.location;
                        const newHeaders = { ...options.headers };
                        if (new URL(url).hostname !== new URL(newUrl).hostname){
                            newHeaders["Referer"] = new URL(url).hostname;
                        }else{
                            newHeaders["Referer"] = url.split("?")[0];
                        }
                        delete newHeaders["Cookie"];
                        // Important: Reset retries for the redirected request
                        // For now, let the redirected request have its own retry attempts.
                        return this.request(newUrl, { ...options, headers: newHeaders });
                    }
                }
                this.redirectcount = 0; // Reset redirect count if not redirecting or max reached

                // Check for non-redirect errors after handling potential redirects
                if (statusCode >= 400) {
                    // Only retry server errors (5xx) by default
                    // For IRCTC, also retry certain 4xx errors that are common during high traffic
                    const retryableCodes = [429, 500, 502, 503, 504];
                    if ((retryableCodes.includes(statusCode)) && retries < this.maxRetries) {
                        // Throw custom error to trigger retry logic below, include status code
                        throw new StatusCodeError(`Request failed with status code ${statusCode}, retrying...`, statusCode);
                    } else {
                        // Non-retryable client error (4xx) or max retries for 5xx reached
                        throw new StatusCodeError(`Request failed with status code ${statusCode}`, statusCode);
                    }
                }

                // Process successful response body
                const processedBody = await this.handlebody(headers, body);
                let data = await this.converttobuffer(processedBody);
                if (headers && Object.prototype.hasOwnProperty.call(headers, "content-type") && data && data.length > 0){
                    if(headers["content-type"].startsWith("application/json")){
                        try {
                            data = JSON.parse(data.toString());
                        } catch (e) {
                            console.warn(`Failed to parse JSON response: ${e.message}`);
                            // Just return the string if parse fails
                            data = data.toString();
                        }
                    }
                    else if(headers["content-type"].startsWith("text")){
                        data = data.toString();
                    }
                }

                return {"statusCode":statusCode,"headers":headers,"body":data}; // Success

            } catch (error) {
                // Check if it's a retryable error (StatusCodeError >= 500 or specific network errors)
                const isRetryableStatusCode = error instanceof StatusCodeError && 
                    [429, 500, 502, 503, 504].includes(error.statusCode);
                    
                // Add specific undici/node network error codes if needed
                const isNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 
                    'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'].includes(error.code);

                // Also retry on timeout errors which are common during Tatkal rush
                const isTimeoutError = error.message && (
                    error.message.includes('timeout') || 
                    error.message.includes('timed out')
                );

                if ((isRetryableStatusCode || isNetworkError || isTimeoutError) && retries < this.maxRetries) {
                    retries++;
                    console.warn(`Request to ${url} failed (Attempt ${retries}/${this.maxRetries}). Retrying in ${currentDelay}ms... Error: ${error.message}`);
                    await sleep(currentDelay);
                    currentDelay *= 1.5; // Less aggressive backoff (1.5x instead of 2x)
                    // Reset redirect count before retrying the same URL
                    this.redirectcount = 0;
                    // Continue loop to retry the request
                } else {
                    // Non-retryable error or max retries reached
                    console.error(`Request to ${url} failed permanently after ${retries} retries. Error: ${error.message}`);
                    this.redirectcount = 0; // Ensure redirect count is reset on final failure
                    throw error; // Re-throw the final error
                }
            }
        }
    }
}
export {BROWSE,StatusCodeError};
export default BROWSE;