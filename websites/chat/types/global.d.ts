declare global {
    namespace NodeJS {
      interface Global {
        libp2pEventEmitter: ServerEventEmitter;
      }
    }
    var libp2pEventEmitter: ServerEventEmitter;
  }