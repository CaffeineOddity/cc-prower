import { FeishuProvider } from './dist/providers/feishu.js';

const provider = new FeishuProvider();
provider.messageCallback = (msg) => {
  console.log("CALLBACK TRIGGERED:", msg);
};

// Mock the handleWsMessage since it's private, we'll access it directly or via any
const rawData = {
  "schema": "2.0",
  "event_id": "9e7c85b4f6fb0c2684e07f99c882b6f3",
  "token": "",
  "create_time": "1773803867260",
  "event_type": "im.message.receive_v1",
  "tenant_key": "14b61e28ff56d74f",
  "app_id": "cli_a93c0992f1399ccd",
  "message": {
    "chat_id": "oc_f43ebe730fa4d06caa88cec9197e8cf7",
    "chat_type": "group",
    "content": "{\"text\":\"@_user_1 hello\"}",
    "create_time": "1773803866941",
    "mentions": [
      {
        "id": {
          "open_id": "ou_4c863557ac984c032182bcc35e5e2ff0"
        },
        "key": "@_user_1",
        "name": "ClaudeCode-cc"
      }
    ],
    "message_id": "om_x100b5495db61f230c4a3204d7b48bae",
    "message_type": "text"
  },
  "sender": {
    "sender_id": {
      "open_id": "ou_3c00b8aff7565410362e148721514d0c"
    },
    "sender_type": "user"
  }
};

provider.handleWsMessage({
  header: { event_type: 'im.message.receive_v1' },
  event: { message: rawData.message, sender: rawData.sender }
});
