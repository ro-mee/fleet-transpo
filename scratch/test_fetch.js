fetch('http://127.0.0.1:3000/api/auth/session').then(r => r.text()).then(t => console.log(t.substring(0, 1000))).catch(console.error);
