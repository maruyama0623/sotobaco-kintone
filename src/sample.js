(() => {
  'use strict';

  kintone.events.on('app.record.index.show', (event) => {
    console.log('kintone JSカスタマイズが動作しています');
    return event;
  });
})();
