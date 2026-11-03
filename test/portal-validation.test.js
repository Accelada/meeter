import test from 'node:test';
import assert from 'node:assert/strict';
import {signupValues,authError} from '../src/portal-validation.js';
test('signup has independent validated fields, normalizes email and preserves password',()=>{
 assert.deepEqual(signupValues({name:' Ana ',email:' ANA@EMPRESA.COM ',password:'12345678 ',confirm:'12345678 '}),{name:'Ana',email:'ana@empresa.com',password:'12345678 '});
 for(const fields of [{name:'',email:'ana@empresa.com',password:'12345678',confirm:'12345678'},{name:'Ana',email:'invalid',password:'12345678',confirm:'12345678'},{name:'Ana',email:'ana@empresa.com',password:'short',confirm:'short'},{name:'Ana',email:'ana@empresa.com',password:'12345678',confirm:'different'}])assert.throws(()=>signupValues(fields));
});
test('provider format and verification errors become actionable Spanish messages',()=>{
 assert.match(authError({message:'Invalid format'}),/correo/);
 assert.match(authError({message:'[body.email] Invalid email address'}),/correo/);
 assert.match(authError({code:'EMAIL_NOT_VERIFIED'}),/Verifica tu correo/);
 assert.match(authError({code:'INVALID_EMAIL_OR_PASSWORD'}),/no son correctos/);
});
