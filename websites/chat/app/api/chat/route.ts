import { agentManager } from '@/agents/agentInit';
import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';

if (typeof window === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.window = dom.window as any;
  global.document = dom.window.document;
  global.CustomEvent = dom.window.CustomEvent;
  // Add any other browser APIs you might need
  global.Event = dom.window.Event;
  global.Node = dom.window.Node;
  global.navigator = dom.window.navigator;
  global.Performance = dom.window.Performance;
  global.PerformanceObserver = dom.window.PerformanceObserver;
}

// Mark this as a server-side only route
// export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!agentManager.initialized) {
      await agentManager.initialize();
    }

    const response = await agentManager.handleMessage(message);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process message' }, 
      { status: 500 }
    );
  }
} 