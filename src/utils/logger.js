/**
 * A simple logger that adds a timestamp and optional data to messages.
 * @param {string} message The message to log.
 * @param {object | null} data Optional data to serialize as JSON.
 */
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    if (data) {
        try {
            // Use a replacer to handle circular references
            const getCircularReplacer = () => {
                const seen = new WeakSet();
                return (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        if (seen.has(value)) {
                            return '[Circular]';
                        }
                        seen.add(value);
                    }
                    return value;
                };
            };
            console.log(JSON.stringify(data, getCircularReplacer(), 2));
        } catch (error) {
            console.log('[Logger Error] Failed to serialize data:', error.message);
        }
    }
}

module.exports = { log }; 