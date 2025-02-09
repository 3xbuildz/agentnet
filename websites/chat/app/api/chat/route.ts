import { agentManager } from "@/agents/agentInit";
import { NextResponse } from "next/server";
import { JSDOM } from 'jsdom';

if (typeof window === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true
  });
  const { window } = dom;

  interface CustomEventInit<T = any> {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
    detail?: T;
  }

  class CustomEventPolyfill<T = any> extends window.Event implements Event {
    public readonly NONE: 0 = 0;
    public readonly CAPTURING_PHASE: 1 = 1;
    public readonly AT_TARGET: 2 = 2;
    public readonly BUBBLING_PHASE: 3 = 3;

    public readonly bubbles: boolean;
    public readonly cancelable: boolean;
    public readonly composed: boolean;
    public readonly currentTarget: EventTarget | null;
    public readonly defaultPrevented: boolean;
    public readonly eventPhase: number;
    public readonly isTrusted: boolean;
    public readonly target: EventTarget | null;
    public readonly timeStamp: number;
    public readonly type: string;
    public detail: T;

    get cancelBubble(): boolean {
      return super.cancelBubble;
    }

    set cancelBubble(value: boolean) {
      super.cancelBubble = value;
    }

    get returnValue(): boolean {
      return !this.defaultPrevented;
    }

    set returnValue(value: boolean) {
      if (!value) {
        this.preventDefault();
      }
    }

    get srcElement(): EventTarget | null {
      return this.target;
    }

    constructor(type: string, eventInitDict: CustomEventInit<T> = {}) {
      super(type, {
        bubbles: eventInitDict.bubbles,
        cancelable: eventInitDict.cancelable,
        composed: eventInitDict.composed
      });

      // Initialize inherited properties
      this.bubbles = super.bubbles;
      this.cancelable = super.cancelable;
      this.composed = super.composed;
      this.currentTarget = super.currentTarget;
      this.defaultPrevented = super.defaultPrevented;
      this.eventPhase = super.eventPhase;
      this.isTrusted = super.isTrusted;
      this.target = super.target;
      this.timeStamp = super.timeStamp;
      this.type = super.type;
      
      // Add custom detail property
      this.detail = eventInitDict.detail as T;
    }

    composedPath(): EventTarget[] {
      return super.composedPath();
    }

    preventDefault(): void {
      super.preventDefault();
    }

    stopImmediatePropagation(): void {
      super.stopImmediatePropagation();
    }

    stopPropagation(): void {
      super.stopPropagation();
    }

    initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void {
      super.initEvent(type, bubbles, cancelable);
    }
  }

  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

  const originalAddEventListener = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (typeof listener === 'function') {
      const wrappedListener = function(this: EventTarget, event: Event) {
        if (event instanceof CustomEventPolyfill) {
          return listener.call(this, event);
        }
        const customEvent = new CustomEventPolyfill(event.type, {
          bubbles: event.bubbles,
          cancelable: event.cancelable,
          composed: event.composed,
          detail: event
        });
        return listener.call(this, customEvent);
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  Object.assign(global, {
    window,
    document: window.document,
    Event: window.Event,
    CustomEvent: CustomEventPolyfill,
    EventTarget: window.EventTarget,
    MessageEvent: window.MessageEvent,
    TextEncoder: global.TextEncoder,
    TextDecoder: global.TextDecoder
  });
}

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }
    if (!agentManager.initialized) {
      await agentManager.initialize();
    }
    const response = await agentManager.handleMessage(message);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}