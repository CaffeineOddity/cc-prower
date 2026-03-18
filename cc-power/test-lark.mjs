import * as lark from '@larksuiteoapi/node-sdk';
const client = new lark.Client({appId: '1', appSecret: '1'});
console.log(Object.keys(client));
console.log(Object.keys(client.contact || {}));
