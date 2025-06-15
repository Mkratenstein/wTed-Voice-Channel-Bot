require('dotenv').config();
const https = require('https');
const http = require('http');
const url = require('url');

const STREAM_URL = process.env.STREAM_URL || 'https://s4.radio.co/s3c11c85d6/listen';

console.log('🔍 Testing wTed Radio Stream URL:', STREAM_URL);
console.log('=' .repeat(60));

async function testStreamURL() {
    try {
        const parsedUrl = url.parse(STREAM_URL);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        console.log('📡 Parsed URL:', {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path
        });
        
        return new Promise((resolve, reject) => {
            console.log('\n🚀 Making HTTP request...');
            
            const req = protocol.request(parsedUrl, (res) => {
                console.log('\n✅ Response received:');
                console.log('Status Code:', res.statusCode);
                console.log('Status Message:', res.statusMessage);
                
                console.log('\n📋 Headers:');
                Object.entries(res.headers).forEach(([key, value]) => {
                    console.log(`  ${key}: ${value}`);
                });
                
                // Check for Icy/Shoutcast headers
                const icyHeaders = Object.entries(res.headers)
                    .filter(([key]) => key.toLowerCase().startsWith('icy-'))
                    .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});
                
                if (Object.keys(icyHeaders).length > 0) {
                    console.log('\n🎵 Icy/Shoutcast Headers Found:');
                    Object.entries(icyHeaders).forEach(([key, value]) => {
                        console.log(`  ${key}: ${value}`);
                    });
                } else {
                    console.log('\n⚠️  No Icy/Shoutcast headers found');
                }
                
                // Test data reception
                let dataReceived = 0;
                let chunks = 0;
                const startTime = Date.now();
                
                console.log('\n📊 Testing data reception...');
                
                res.on('data', (chunk) => {
                    dataReceived += chunk.length;
                    chunks++;
                    
                    if (chunks === 1) {
                        console.log(`✅ First data chunk received: ${chunk.length} bytes`);
                    }
                    
                    if (chunks % 10 === 0) {
                        const elapsed = (Date.now() - startTime) / 1000;
                        const rate = (dataReceived / 1024 / elapsed).toFixed(2);
                        console.log(`📈 Chunks: ${chunks}, Data: ${(dataReceived/1024).toFixed(2)}KB, Rate: ${rate}KB/s`);
                    }
                });
                
                res.on('end', () => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    console.log(`\n🏁 Stream ended after ${elapsed}s`);
                    console.log(`📊 Total: ${chunks} chunks, ${(dataReceived/1024).toFixed(2)}KB`);
                    resolve({ success: true, dataReceived, chunks, elapsed });
                });
                
                res.on('error', (error) => {
                    console.log('\n❌ Response error:', error.message);
                    reject(error);
                });
                
                // Stop test after 10 seconds
                setTimeout(() => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    console.log(`\n⏹️  Test stopped after ${elapsed}s`);
                    console.log(`📊 Total: ${chunks} chunks, ${(dataReceived/1024).toFixed(2)}KB`);
                    
                    if (dataReceived > 0) {
                        console.log('✅ Stream is working - data is flowing!');
                        resolve({ success: true, dataReceived, chunks, elapsed });
                    } else {
                        console.log('❌ No data received - stream may be down');
                        reject(new Error('No data received'));
                    }
                    
                    req.destroy();
                }, 10000);
            });
            
            req.on('error', (error) => {
                console.log('\n❌ Request error:', error.message);
                console.log('Error code:', error.code);
                reject(error);
            });
            
            req.setTimeout(15000, () => {
                console.log('\n⏰ Request timeout');
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
        
    } catch (error) {
        console.log('\n💥 Test failed:', error.message);
        throw error;
    }
}

// Run the test
testStreamURL()
    .then((result) => {
        console.log('\n🎉 Stream test completed successfully!');
        console.log('Result:', result);
        process.exit(0);
    })
    .catch((error) => {
        console.log('\n💥 Stream test failed:', error.message);
        process.exit(1);
    }); 