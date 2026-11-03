import {createAuthClient} from '@neon/auth';
export const authClient=createAuthClient(`${location.origin}/auth`);
export async function identityToken(){
 const {data,error}=await authClient.token();
 if(error || !data?.token)throw new Error('Inicia sesión con tu cuenta.');return data.token;
}
