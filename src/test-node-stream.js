const https = require('https');

const STREAM_URL = 'https://s4.radio.co/s3c11c85d6/listen';

console.log('=== Node.js Stream Test ===');
console.log(`Testing stream: ${STREAM_URL}`);
console.log('');

async function testNodeStream() {
    try {
        console.log('Creating Node.js HTTPS request...');
        
        const stream = await new Promise((resolve, reject) => {
            const request = https.get(STREAM_URL, (response) => {
                console.log(`Response status: ${response.statusCode}`);
                console.log(`Content-Type: ${response.headers['content-type']}`);
                console.log(`ICY-Name: ${response.headers['icy-name']}`);
                console.log(`ICY-BR: ${response.headers['icy-br']}`);
                console.log('');
                
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    console.log(`Redirect to: ${response.headers.location}`);
                    https.get(response.headers.location, (redirectedResponse) => {
                        if (redirectedResponse.statusCode === 200) {
                            console.log('Redirect successful');
                            resolve(redirectedResponse);
                        } else {
                            redirectedResponse.resume();
                            reject(new Error(`Redirect failed with status code: ${redirectedResponse.statusCode}`));
                        }
                    }).on('error', reject);
                } else if (response.statusCode === 200) {
                    resolve(response);
                } else {
                    response.resume();
                    reject(new Error(`Request failed with status code: ${response.statusCode}`));
                }
            });
            
            request.on('error', (error) => {
                console.log(`Request error: ${error.message}`);
                reject(error);
            });

            request.setTimeout(15000, () => {
                console.log('Request timeout');
                request.destroy();
                reject(new Error('Request timed out after 15 seconds'));
            });
        });

        console.log('Stream connection established successfully!');
        console.log('Monitoring data flow...');
        
        let bytesReceived = 0;
        let dataChunks = 0;
        const startTime = Date.now();
        
        stream.on('data', (chunk) => {
            bytesReceived += chunk.length;
            dataChunks++;
            
            if (dataChunks <= 10) {
                console.log(`Data chunk ${dataChunks}: ${chunk.length} bytes`);
            }
            
            // Stop after receiving 50KB to avoid running forever
            if (bytesReceived >= 51200) {
                const duration = Date.now() - startTime;
                console.log('');
                console.log('=== TEST RESULTS ===');
                console.log(`✅ SUCCESS: Received ${bytesReceived} bytes in ${dataChunks} chunks`);
                console.log(`⏱️  Duration: ${duration}ms`);
                console.log(`📊 Average rate: ${Math.round((bytesReceived / 1024) / (duration / 1000))} KB/s`);
                console.log('');
                console.log('🎉 Node.js stream method is working correctly!');
                console.log('The audio streaming issue should now be resolved.');
                
                stream.destroy();
                process.exit(0);
            }
        });
        
        stream.on('error', (error) => {
            console.log(`❌ Stream error: ${error.message}`);
            process.exit(1);
        });
        
        stream.on('end', () => {
            console.log('Stream ended');
            if (bytesReceived === 0) {
                console.log('❌ FAILED: No data received');
                process.exit(1);
            }
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
            if (bytesReceived === 0) {
                console.log('❌ TIMEOUT: No data received within 30 seconds');
                process.exit(1);
            }
        }, 30000);
        
    } catch (error) {
        console.log(`❌ Test failed: ${error.message}`);
        process.exit(1);
    }
}

testNodeStream(); 