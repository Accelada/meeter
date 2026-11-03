export function signupValues({name,email,password,confirm}){
 name=String(name || '').trim();email=String(email || '').trim().toLowerCase();
 if(!name || name.length>160)throw new Error('Escribe tu nombre completo (máximo 160 caracteres).');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)throw new Error('Introduce un correo válido, por ejemplo nombre@empresa.com.');
 if(typeof password!=='string' || password.length<8 || password.length>128)throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
 if(password!==confirm)throw new Error('Las contraseñas no coinciden.');
 return {name,email,password};
}
export function authError(error){
 const messages={INVALID_EMAIL:'Introduce un correo válido, por ejemplo nombre@empresa.com.',INVALID_EMAIL_OR_PASSWORD:'El correo o la contraseña no son correctos.',INVALID_PASSWORD:'Revisa la contraseña.',PASSWORD_TOO_SHORT:'La contraseña debe tener al menos 8 caracteres.',PASSWORD_TOO_LONG:'La contraseña no puede superar los 128 caracteres.',EMAIL_NOT_VERIFIED:'Verifica tu correo antes de entrar. Abre «Verificar mi correo» para solicitar el código.',USER_ALREADY_EXISTS:'Ya existe una cuenta con ese correo. Inicia sesión o recupera la contraseña.',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'Ya existe una cuenta con ese correo. Inicia sesión o recupera la contraseña.',INVALID_OTP:'El código no es correcto o ha caducado. Solicita uno nuevo.',OTP_EXPIRED:'El código ha caducado. Solicita uno nuevo.',TOO_MANY_REQUESTS:'Demasiados intentos. Espera unos minutos y vuelve a probar.'};
 if(messages[error?.code])return messages[error.code];
 const message=error?.message || 'No se pudo completar la operación. Vuelve a intentarlo.';
 if(/invalid.*format|invalid.*email|validation.*error/i.test(message) || error?.code==='VALIDATION_ERROR')return 'Revisa el formato del correo y completa los campos del formulario.';
 return message;
}
