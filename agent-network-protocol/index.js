import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { noise } from "@libp2p/noise";
import { tcp } from "@libp2p/tcp";
import { createLibp2p } from "libp2p";
import { EventEmitter } from 'events';
import axios from "axios";
import { SystemAgent } from './agents/SystemAgent.js';
import { UserAgent } from './agents/UserAgent.js';
import { getProtocolTools } from './tools.js';

export default class AgentNetworkProtocol {
    constructor() {
        this.registrarUrl = 'http://localhost:3005';
        this.messageHandlers = new Map();
        this.pendingResponses = new Map();
        this.nodes = new Map();
        this.systemAgents = new Map();
        this.userAgents = new Map();
        this.eventEmitter = new EventEmitter();
        // Increase max listeners to prevent memory leak warnings
        this.eventEmitter.setMaxListeners(100);
    }

    async initialize() {
        this.baseConfig = {
            addresses: {
                listen: ['/ip4/127.0.0.1/tcp/0']
            },
            transports: [tcp()],
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            services: {
                identify: identify(),
                pubsub: gossipsub({
                    emitSelf: true,
                    allowPublishToZeroPeers: true,
                    gossipIncoming: true,
                    fallbackToFloodsub: true,
                    floodPublish: true,
                }),
                dht: kadDHT({
                    clientMode: false,
                    pingTimeout: 5000,
                    maxInboundStreams: 5000,
                    maxOutboundStreams: 5000,
                })
            }
        };
    }

    async createNode() {
        const port = Math.floor(Math.random() * (65535 - 1024) + 1024);
        const nodeConfig = {
            ...this.baseConfig,
            addresses: {
                listen: [`/ip4/127.0.0.1/tcp/${port}`]
            }
        };

        const node = await createLibp2p(nodeConfig);
        await node.start();

        await new Promise(resolve => setTimeout(resolve, 1000));

        const topic = `/agent/${node.peerId.toString()}`;
        await node.services.pubsub.subscribe(topic);

        // Use direct event handler instead of CustomEvent
        node.services.pubsub.addEventListener = (event, handler) => {
            this.eventEmitter.on(event, handler);
        };

        // Hook into the pubsub message event
        node.services.pubsub.topicHandlers.set(topic, (message) => {
            this.eventEmitter.emit('message', {
                detail: {
                    topic,
                    data: message.data
                }
            });
        });

        return node;
    }

    async deploySystemAgent(agentConfig, agentMetadata) {
        if (!this.baseConfig) {
            throw new Error('Protocol not initialized. Call initialize() first.');
        }

        const { name, description, capabilities, walletAddress } = agentMetadata;
        if (!name || !description || !capabilities) {
            throw new Error('Missing required agent metadata');
        }

        const systemAgent = new SystemAgent(agentConfig);
        await systemAgent.initialize();

        const node = await this.createNode();
        const peerId = node.peerId.toString();

        this.nodes.set(peerId, node);
        this.systemAgents.set(peerId, systemAgent);

        this.messageHandlers.set(peerId, async (message) => {
            const response = await systemAgent.handleMessage(message);
            return response;
        });

        try {
            await this._registerAgent({
                peerId,
                name,
                description,
                capabilities,
                walletAddress
            });
            console.log('Successfully registered system agent:', name, 'with peerId:', peerId);

            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.connectNodes();

        } catch (error) {
            await node.stop();
            this.nodes.delete(peerId);
            this.messageHandlers.delete(peerId);
            throw error;
        }

        return {
            peerId,
            agentMetadata
        };
    }

    async createUserAgent(agentConfig) {
        if (!this.baseConfig) {
            throw new Error('Protocol not initialized. Call initialize() first.');
        }

        const userAgent = new UserAgent(agentConfig, this);
        await userAgent.initialize();

        const node = await this.createNode();
        const peerId = node.peerId.toString();

        this.nodes.set(peerId, node);
        this.userAgents.set(peerId, userAgent);

        return userAgent;
    }

    async findAgentsByCapability(capability) {
        try {
            console.log('Protocol searching for capability:', capability);
            const response = await axios.get(
                `${this.registrarUrl}/lookup?capability=${capability}`
            );
            console.log('Protocol received response:', response.data);
            return response.data;
        } catch (error) {
            console.error('Protocol error finding agents:', error);
            throw new Error(`Failed to find agents: ${error.message}`);
        }
    }

    async sendMessage(targetPeerId, message) {
        console.log('\n=== Sending Message ===');
        console.log('Target PeerId:', targetPeerId);
        console.log('Message:', message);

        const nodes = Array.from(this.nodes.values());
        if (nodes.length === 0) {
            throw new Error('No nodes available to send message');
        }

        let senderNode = this.nodes.get(targetPeerId);
        if (!senderNode) {
            console.log('Using fallback sender node');
            senderNode = nodes[0];
        }

        try {
            const topic = `/agent/${targetPeerId}`;
            console.log('Publishing to topic:', topic);

            const responsePromise = new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    this.pendingResponses.delete(senderNode.peerId.toString());
                    reject(new Error(`Response timeout waiting for agent ${targetPeerId}. The agent may be busy or not responding.`));
                }, 30000);

                console.log('Setting up response handler for:', senderNode.peerId.toString());
                this.pendingResponses.set(senderNode.peerId.toString(), (response) => {
                    console.log('Received response:', response);
                    clearTimeout(timeoutId);
                    resolve(response);
                });
            });

            // Ensure subscription
            if (!senderNode.services.pubsub.getTopics().includes(topic)) {
                await senderNode.services.pubsub.subscribe(topic);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Send message
            const messageData = JSON.stringify({
                to: targetPeerId,
                from: senderNode.peerId.toString(),
                content: message,
                timestamp: Date.now()
            });

            await senderNode.services.pubsub.publish(
                topic,
                new TextEncoder().encode(messageData)
            );
            console.log('Message published successfully');

            // Wait for response
            return await responsePromise;

        } catch (error) {
            console.error('Error sending message:', error);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    async handleIncomingMessage(message) {
        try {
            const data = JSON.parse(typeof message.data === 'string' ? message.data : new TextDecoder().decode(message.data));
            console.log('\n=== Incoming Message ===');
            console.log('Message data:', data);

            if (data.isResponse) {
                const resolver = this.pendingResponses.get(data.to);
                if (resolver) {
                    resolver(data.content);
                    this.pendingResponses.delete(data.to);
                }
                return;
            }

            const handler = this.messageHandlers.get(data.to);
            if (handler) {
                try {
                    const response = await handler(data.content);
                    if (!response) return;

                    const receivingNode = this.nodes.get(data.to);
                    if (!receivingNode) return;

                    const responseData = {
                        to: data.from,
                        from: data.to,
                        content: response,
                        timestamp: Date.now(),
                        isResponse: true
                    };

                    const responseTopic = `/agent/${data.from}`;
                    const encodedResponse = new TextEncoder().encode(JSON.stringify(responseData));
                    
                    await receivingNode.services.pubsub.publish(responseTopic, encodedResponse);

                } catch (error) {
                    console.error('Error processing message:', error);
                    const errorResponse = {
                        to: data.from,
                        from: data.to,
                        content: { type: 'error', content: error.message },
                        timestamp: Date.now(),
                        isResponse: true
                    };

                    const receivingNode = this.nodes.get(data.to);
                    if (receivingNode) {
                        await receivingNode.services.pubsub.publish(
                            `/agent/${data.from}`,
                            new TextEncoder().encode(JSON.stringify(errorResponse))
                        );
                    }
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }


    async _registerAgent(registrationData) {
        try {
            const response = await axios.post(
                `${this.registrarUrl}/register`,
                registrationData
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to register agent: ${error.message}`);
        }
    }

    async stop() {
        for (const [peerId, node] of this.nodes) {
            await node.stop();
            this.nodes.delete(peerId);
            this.messageHandlers.delete(peerId);
        }
    }

    async connectNodes() {
        const connectedPeers = new Set();

        for (const [peerId, node] of this.nodes) {
            for (const [otherPeerId, otherNode] of this.nodes) {
                if (peerId !== otherPeerId && !connectedPeers.has(`${peerId}-${otherPeerId}`)) {
                    try {
                        const topic = `/agent/${otherPeerId}`;
                        await node.services.pubsub.subscribe(topic);

                        let connected = false;
                        let attempts = 0;
                        while (!connected && attempts < 3) {
                            try {
                                await node.dial(otherNode.peerId);
                                connected = true;
                                console.log(`Successfully connected ${peerId} to ${otherPeerId}`);
                            } catch (error) {
                                attempts++;
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }

                        connectedPeers.add(`${peerId}-${otherPeerId}`);
                        connectedPeers.add(`${otherPeerId}-${peerId}`);

                    } catch (error) {
                        console.error(`Failed to connect ${peerId} to ${otherPeerId}:`, error.message);
                    }
                }
            }
        }
    }

    getTools() {
        return getProtocolTools(this);
    }
}