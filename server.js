import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  initDatabase,   // Inicializa la base de datos
  getAllMarcadores,
  getMarcadorById,
  createMarcador, 
  updateMarcador,
  deleteMarcador,//comentario
  saveCoordenadaGPS,
  getUltimasCoordenadas,
  getCoordenadasPorRango,
  getEstadisticasMarcadores,
  registrarOActualizarUsuario,
  getUsuarioById,
  getUsuariosConectados,
  closeDatabase,
  verificarCredenciales,
  crearUsuariosEjemplo,
  crearTokenSesion,
  validarTokenSesion,
  invalidarTokenSesion,
  invalidarTodosTokensUsuario,
  limpiarTokensExpirados
} from './database.js';
import { upload, getFileUrl, deleteFile } from './utils/fileUpload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Configuración desde variables de entorno
const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:4200', 
      'http://127.0.0.1:4200', 
      'http://localhost:4401', 
      'http://127.0.0.1:4401',
      'https://map.robertogroup.org',
      'http://map.robertogroup.org'
    ];
const JSON_LIMIT = process.env.JSON_LIMIT || '10mb';
const NODE_ENV = process.env.NODE_ENV || 'development';

const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      // Permitir requests sin origen (como mobile apps)
      if (!origin) return callback(null, true);
      
      // Verificar si el origen está en la lista permitida
      if (CORS_ORIGINS.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        // También permitir subdominios de robertogroup.org
        if (origin.includes('.robertogroup.org') || origin === 'https://robertogroup.org' || origin === 'http://robertogroup.org') {
          callback(null, true);
        } else {
          console.warn(`⚠️  Origen CORS no permitido para Socket.IO: ${origin}`);
          callback(new Error('No permitido por CORS'));
        }
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  }
});

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sin origen (como mobile apps o Postman)
    if (!origin) return callback(null, true);
    
    // Verificar si el origen está en la lista permitida
    if (CORS_ORIGINS.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // También permitir subdominios de robertogroup.org
      if (origin.includes('.robertogroup.org') || origin === 'https://robertogroup.org' || origin === 'http://robertogroup.org') {
        callback(null, true);
      } else {
        console.warn(`⚠️  Origen CORS no permitido: ${origin}`);
        callback(new Error('No permitido por CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));

// Servir archivos estáticos desde storage
app.use('/api/files', express.static(join(__dirname, 'storage')));

// Inicializar base de datos
initDatabase();
// Crear usuarios de ejemplo después de inicializar la base de datos
crearUsuariosEjemplo();

// ==================== RUTAS API ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Fleet Tracking Server is running' });
});

// ==================== MARCADORES ====================

// GET - Obtener todos los marcadores (OPTIMIZADO)
app.get('/api/marcadores', (req, res) => {
  try {
    // OPTIMIZACIÓN: Obtener marcadores de forma eficiente
    const marcadores = getAllMarcadores();
    
    // OPTIMIZACIÓN: Enviar respuesta inmediatamente sin procesamiento adicional
    res.json({ success: true, data: marcadores });
  } catch (error) {
    console.error('Error al obtener marcadores:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Obtener un marcador por ID
app.get('/api/marcadores/:id', (req, res) => {
  try {
    const marcador = getMarcadorById(req.params.id);
    if (!marcador) {
      return res.status(404).json({ success: false, error: 'Marcador no encontrado' });
    }
    res.json({ success: true, data: marcador });
  } catch (error) {
    console.error('Error al obtener marcador:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Función auxiliar para determinar la carpeta según el tipo MIME
function getFileFolder(mimetype) {
  if (mimetype?.startsWith('image/')) return 'imagenes';
  if (mimetype?.startsWith('video/')) return 'videos';
  return 'documentos';
}

// POST - Crear un nuevo marcador (con soporte para archivos)
app.post('/api/marcadores', upload.single('archivo'), (req, res) => {
  try {
    const { lat, lng, categoria, descripcion } = req.body;
    const archivo = req.file;

    // Validaciones
    if (!lat || !lng) {
      // Si se subió un archivo pero hay error, eliminarlo
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(400).json({ success: false, error: 'Latitud y longitud son requeridas' });
    }
    if (!categoria || !['alerta', 'peligro', 'informacion'].includes(categoria)) {
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(400).json({ success: false, error: 'Categoría inválida' });
    }
    if (!descripcion || descripcion.trim().length < 10) {
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(400).json({ success: false, error: 'Descripción debe tener al menos 10 caracteres' });
    }

    // Procesar archivo si existe
    let archivoUrl = null;
    if (archivo) {
      const folder = getFileFolder(archivo.mimetype);
      archivoUrl = getFileUrl(archivo.filename, folder);
    }

    const marcador = createMarcador({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      categoria,
      descripcion: descripcion.trim(),
      archivo: archivoUrl, // Guardar URL en lugar de Base64
      user_id: req.body.user_id || null, // Agregar user_id si está disponible
      timestamp: new Date().toISOString()
    });

    // Emitir evento Socket.IO para notificar a los clientes (excepto al creador)
    // Usar la función helper para emitir solo a otros usuarios
    const creatorUserId = req.body.user_id || null;
    if (creatorUserId) {
      console.log(`📤 Emitiendo marcador:creado a otros usuarios (excluyendo: ${creatorUserId})`);
      emitToOthers(creatorUserId, 'marcador:creado', marcador).catch(err => {
        console.error('Error al emitir marcador:creado:', err);
      });
    } else {
      // Si no hay userId, emitir a todos (compatibilidad hacia atrás)
      console.log('⚠️  Marcador creado sin userId, emitiendo a todos los clientes');
      io.emit('marcador:creado', marcador);
    }

    res.status(201).json({ success: true, data: marcador });
  } catch (error) {
    console.error('Error al crear marcador:', error);
    // Si hay error y se subió archivo, eliminarlo
    if (req.file) {
      deleteFile(req.file.filename, getFileFolder(req.file.mimetype));
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT - Actualizar un marcador (con soporte para archivos)
app.put('/api/marcadores/:id', upload.single('archivo'), (req, res) => {
  try {
    const { lat, lng, categoria, descripcion } = req.body;
    const archivo = req.file;
    const marcadorActual = getMarcadorById(req.params.id);

    // Validaciones
    if (!lat || !lng) {
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(400).json({ success: false, error: 'Latitud y longitud son requeridas' });
    }
    if (categoria && !['alerta', 'peligro', 'informacion'].includes(categoria)) {
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(400).json({ success: false, error: 'Categoría inválida' });
    }
    if (descripcion && descripcion.trim().length < 10) {
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(400).json({ success: false, error: 'Descripción debe tener al menos 10 caracteres' });
    }

    // Si hay un nuevo archivo, eliminar el anterior
    let archivoUrl = marcadorActual?.archivo || null;
    if (archivo) {
      // Eliminar archivo anterior si existe
      if (marcadorActual?.archivo) {
        const urlParts = marcadorActual.archivo.split('/');
        const filename = urlParts[urlParts.length - 1];
        const folder = urlParts[urlParts.length - 2];
        deleteFile(filename, folder);
      }
      // Guardar nuevo archivo
      const folder = getFileFolder(archivo.mimetype);
      archivoUrl = getFileUrl(archivo.filename, folder);
    }

    const marcador = updateMarcador(req.params.id, {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      categoria,
      descripcion: descripcion?.trim(),
      archivo: archivoUrl
    });

    if (!marcador) {
      if (archivo) deleteFile(archivo.filename, getFileFolder(archivo.mimetype));
      return res.status(404).json({ success: false, error: 'Marcador no encontrado' });
    }

    // Emitir evento Socket.IO (excepto al usuario que actualizó)
    emitToOthers(req.body.user_id, 'marcador:actualizado', marcador).catch(err => {
      console.error('Error al emitir marcador:actualizado:', err);
    });

    res.json({ success: true, data: marcador });
  } catch (error) {
    console.error('Error al actualizar marcador:', error);
    if (req.file) {
      deleteFile(req.file.filename, getFileFolder(req.file.mimetype));
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE - Eliminar un marcador (y su archivo asociado)
app.delete('/api/marcadores/:id', (req, res) => {
  try {
    const marcador = getMarcadorById(req.params.id);
    
    if (!marcador) {
      return res.status(404).json({ success: false, error: 'Marcador no encontrado' });
    }

    // Eliminar archivo asociado si existe
    if (marcador.archivo) {
      try {
        const urlParts = marcador.archivo.split('/');
        const filename = urlParts[urlParts.length - 1];
        const folder = urlParts[urlParts.length - 2];
        deleteFile(filename, folder);
      } catch (fileError) {
        console.warn('No se pudo eliminar el archivo:', fileError);
      }
    }

    // Obtener user_id antes de eliminar
    const marcadorUserId = marcador.user_id || null;

    const deleted = deleteMarcador(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Marcador no encontrado' });
    }

    // Emitir evento Socket.IO (excepto al usuario que eliminó)
    emitToOthers(marcadorUserId, 'marcador:eliminado', { id: req.params.id }).catch(err => {
      console.error('Error al emitir marcador:eliminado:', err);
    });

    res.json({ success: true, message: 'Marcador eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar marcador:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Estadísticas de marcadores
app.get('/api/marcadores/stats/estadisticas', (req, res) => {
  try {
    const stats = getEstadisticasMarcadores();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== COORDENADAS GPS ====================

// POST - Guardar coordenada GPS
app.post('/api/coordenadas', (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'Latitud y longitud son requeridas' });
    }

    const id = saveCoordenadaGPS({
      lat,
      lng,
      accuracy,
      timestamp: new Date().toISOString()
    });

    // Emitir evento Socket.IO para tracking en tiempo real
    // Nota: Este endpoint se mantiene por compatibilidad, pero el socket ya maneja esto
    io.emit('coordenada:nueva', { 
      id, 
      lat, 
      lng, 
      accuracy, 
      user_id: req.body.user_id || null,
      timestamp: new Date().toISOString() 
    });

    res.status(201).json({ success: true, data: { id, lat, lng, accuracy } });
  } catch (error) {
    console.error('Error al guardar coordenada:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Obtener últimas coordenadas GPS
app.get('/api/coordenadas', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const coordenadas = getUltimasCoordenadas(limit);
    res.json({ success: true, data: coordenadas });
  } catch (error) {
    console.error('Error al obtener coordenadas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Obtener coordenadas por rango de tiempo
app.get('/api/coordenadas/rango', (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ success: false, error: 'fechaInicio y fechaFin son requeridos' });
    }

    const coordenadas = getCoordenadasPorRango(fechaInicio, fechaFin);
    res.json({ success: true, data: coordenadas });
  } catch (error) {
    console.error('Error al obtener coordenadas por rango:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SOCKET.IO ====================

// Mapa para mantener la relación userId -> socketId
const userSocketMap = new Map();
// Mapa para rastrear si un usuario ya fue notificado como conectado en esta sesión
const usuariosNotificados = new Map();
// Mapa para almacenar las últimas ubicaciones de cada usuario conectado
// Estructura: { userId: { lat, lng, speed, timestamp } }
const ultimasUbicaciones = new Map();
// Mapa para almacenar usuarios logueados con su información
// Estructura: { socketId: { usuario, rol, estado } }
const usuariosLogueados = new Map();

io.on('connection', (socket) => {
  console.log(`✅ Cliente conectado: ${socket.id}`);

  // Enviar todos los marcadores al cliente cuando se conecta
  socket.emit('marcadores:iniciales', getAllMarcadores());

  // ==================== REGISTRO DE USUARIO ====================
  socket.on('usuario-conectado', async (data) => {
    try {
      const { id, nombre, plataforma, modeloDispositivo } = data;
      
      if (!id) {
        console.warn('⚠️  Intento de conexión sin ID de usuario');
        return;
      }

      // Verificar si el usuario ya estaba conectado (reconexión)
      let yaEstabaConectado = false;
      const socketIdAnterior = userSocketMap.get(id);
      
      // Si hay un socket anterior, verificar si realmente está conectado
      if (socketIdAnterior) {
        try {
          const sockets = await io.fetchSockets();
          const socketAnteriorActivo = sockets.find(s => s.id === socketIdAnterior);
          yaEstabaConectado = !!socketAnteriorActivo;
          
          // Si el socket anterior no está activo, limpiar el mapa
          if (!socketAnteriorActivo) {
            userSocketMap.delete(id);
            usuariosNotificados.delete(id);
            yaEstabaConectado = false;
          }
        } catch (error) {
          console.warn('Error al verificar sockets activos:', error);
          // En caso de error, asumir que es una nueva conexión
          yaEstabaConectado = false;
        }
      }

      // Guardar userId en el socket para referencia posterior
      socket.userId = id;
      
      // Registrar o actualizar usuario en la base de datos (primero obtener los datos)
      const usuario = registrarOActualizarUsuario({
        id,
        nombre: nombre || null,
        plataforma: plataforma || 'web',
        modeloDispositivo: modeloDispositivo || null
      });
      
      // Guardar información del usuario en el socket para usar al desconectar
      socket.userInfo = {
        numUsuario: usuario.num_usuario || null,
        nombre: usuario.nombre || null,
        plataforma: usuario.plataforma || 'web'
      };
      
      // Actualizar el mapa de usuarios conectados con el nuevo socket
      userSocketMap.set(id, socket.id);

      if (yaEstabaConectado) {
        console.log(`🔄 Usuario reconectado: ${id} (${usuario.plataforma || 'web'}) - Número: ${usuario.num_usuario || 'N/A'}`);
      } else {
        console.log(`👤 Usuario ${usuario.actualizado ? 'actualizado' : 'registrado'}: ${id} (${usuario.plataforma || 'web'}) - Número: ${usuario.num_usuario || 'N/A'}`);
      }

      // Solo notificar a otros usuarios si es una nueva conexión (no reconexión)
      if (!yaEstabaConectado) {
        // Marcar como notificado
        usuariosNotificados.set(id, true);
        
        // Notificar a otros usuarios que alguien se conectó (excepto al mismo)
        socket.broadcast.emit('cliente-conectado', {
          userId: id,
          numUsuario: usuario.num_usuario || null,
          nombre: nombre || null,
          plataforma: plataforma || 'web',
          timestamp: new Date().toISOString()
        });
      }

      // Confirmar al usuario que se registró correctamente
      socket.emit('usuario-registrado', {
        success: true,
        userId: id,
        usuario: getUsuarioById(id)
      });

      // Enviar todas las ubicaciones de usuarios ya conectados al nuevo usuario
      if (ultimasUbicaciones.size > 0) {
        const ubicacionesExistentes = Array.from(ultimasUbicaciones.entries()).map(([userId, ubicacion]) => ({
          userId,
          lat: ubicacion.lat,
          lng: ubicacion.lng,
          speed: ubicacion.speed || 0,
          timestamp: ubicacion.timestamp || Date.now()
        }));

        // Enviar todas las ubicaciones al nuevo usuario
        socket.emit('ubicaciones-usuarios-conectados', ubicacionesExistentes);
        console.log(`📍 Enviadas ${ubicacionesExistentes.length} ubicación(es) de usuarios conectados al nuevo usuario ${id}`);
      }
    } catch (error) {
      console.error('❌ Error al registrar usuario:', error);
      socket.emit('usuario-registrado', {
        success: false,
        error: error.message
      });
    }
  });

  // ==================== ACTUALIZACIÓN DE UBICACIÓN ====================
  socket.on('coordenada:actualizar', (data) => {
    try {
      const { lat, lng, accuracy, userId } = data;
      
      if (!lat || !lng) {
        console.warn('⚠️  Coordenada inválida recibida');
        return;
      }

      // Usar userId del socket si no viene en los datos
      const user_id = userId || socket.userId || null;

      // Guardar coordenada en la base de datos
      const id = saveCoordenadaGPS({
        user_id,
        lat,
        lng,
        accuracy,
        timestamp: new Date().toISOString()
      });
      
      // Obtener información del usuario para incluir en el evento
      let usuarioInfo = null;
      if (user_id) {
        try {
          usuarioInfo = getUsuarioById(user_id);
        } catch (error) {
          console.warn('Error al obtener información del usuario:', error);
        }
      }

      // Emitir a todos los clientes EXCEPTO al que envió (usando broadcast)
      socket.broadcast.emit('coordenada:nueva', {
        id,
        lat,
        lng,
        accuracy,
        user_id,
        numUsuario: usuarioInfo?.num_usuario || null,
        plataforma: usuarioInfo?.plataforma || null,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error al procesar coordenada:', error);
    }
  });

  // ==================== UBICACIÓN EN TIEMPO REAL ====================
  socket.on('ubicacion-actual', (data) => {
    try {
      const { userId, lat, lng, speed, accuracy, timestamp } = data;

      if (!lat || !lng) {
        console.warn('⚠️  Ubicación inválida recibida');
        return;
      }

      // Usar userId del socket si no viene en los datos
      const user_id = userId || socket.userId || null;

      if (!user_id) {
        console.warn('⚠️  Ubicación recibida sin userId');
        return;
      }

      // Guardar coordenada en la base de datos (opcional, para historial)
      try {
        saveCoordenadaGPS({
          user_id,
          lat,
          lng,
          accuracy: accuracy || null,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.warn('Error al guardar coordenada en BD:', error);
      }

      // Actualizar el mapa de últimas ubicaciones
      ultimasUbicaciones.set(user_id, {
        lat,
        lng,
        speed: speed || 0,
        timestamp: timestamp || Date.now()
      });

      // Reenviar ubicación a todos EXCEPTO al cliente emisor
      socket.broadcast.emit('ubicacion-usuario', {
        userId: user_id,
        lat,
        lng,
        speed: speed || 0,
        timestamp: timestamp || Date.now()
      });

      console.log(`📍 Ubicación recibida de usuario ${user_id} y reenviada a otros clientes`);
    } catch (error) {
      console.error('❌ Error al procesar ubicación:', error);
    }
  });

  // ==================== LOGIN ====================
  socket.on('login', (data) => {
    try {
      const { usuario, clave } = data;

      console.log(`🔐 Intento de login recibido para usuario: ${usuario}`);

      if (!usuario || !clave) {
        console.warn('⚠️ Login fallido: Usuario o contraseña faltantes');
        socket.emit('login-respuesta', {
          success: false,
          error: 'Usuario y contraseña son requeridos'
        });
        return;
      }

      // Verificar credenciales
      const usuarioEncontrado = verificarCredenciales(usuario, clave);
      
      console.log(`🔍 Resultado de verificación:`, usuarioEncontrado ? `Usuario encontrado (${usuarioEncontrado.rol})` : 'Credenciales inválidas');

      if (usuarioEncontrado) {
        // Login exitoso
        // Guardar información del usuario en el socket
        socket.userLogin = {
          id: usuarioEncontrado.id,
          usuario: usuarioEncontrado.usuario,
          rol: usuarioEncontrado.rol,
          estado: usuarioEncontrado.estado
        };

        // Guardar en el mapa de usuarios logueados
        usuariosLogueados.set(socket.id, {
          usuario: usuarioEncontrado.usuario,
          rol: usuarioEncontrado.rol,
          estado: usuarioEncontrado.estado
        });

        // Generar token de sesión
        const token = crearTokenSesion(usuarioEncontrado.id, 30); // Token válido por 30 días
        
        // IMPORTANTE: Enviar respuesta INMEDIATAMENTE después de validar
        const respuestaLogin = {
          success: true,
          usuario: {
            id: usuarioEncontrado.id,
            usuario: usuarioEncontrado.usuario,
            rol: usuarioEncontrado.rol,
            estado: usuarioEncontrado.estado
          },
          token: token // Incluir token en la respuesta
        };
        
        // IMPORTANTE: Enviar respuesta PRIMERO, antes de cualquier otra operación
        socket.emit('login-respuesta', respuestaLogin);
        console.log(`✅ Login exitoso: ${usuario} (rol: ${usuarioEncontrado.rol}) - Token generado`);

        // DESPUÉS de enviar la respuesta, hacer las notificaciones (no bloquean)
        // Si el usuario es conductor, notificar a todos los usuarios conectados
        if (usuarioEncontrado.rol === 'conductor') {
          // Usar setImmediate para no bloquear la respuesta
          setImmediate(() => {
            io.emit('notificacion-conductor', {
              tipo: 'activo',
              usuario: usuarioEncontrado.usuario,
              mensaje: `Conductor: ${usuarioEncontrado.usuario} activo`
            });
            console.log(`📢 Notificación enviada: Conductor ${usuarioEncontrado.usuario} activo`);
          });
        }

        // Notificar a los conductores conectados sobre el nuevo login (también asíncrono)
        setImmediate(() => {
          usuariosLogueados.forEach((userInfo, socketId) => {
            if (userInfo.rol === 'conductor' && socketId !== socket.id) {
              const conductorSocket = io.sockets.sockets.get(socketId);
              if (conductorSocket) {
                conductorSocket.emit('notificacion-usuario-logueado', {
                  usuario: usuarioEncontrado.usuario,
                  rol: usuarioEncontrado.rol,
                  mensaje: `Usuario ${usuarioEncontrado.usuario} (${usuarioEncontrado.rol}) ha iniciado sesión`
                });
              }
            }
          });
        });
      } else {
        // Credenciales inválidas
        socket.emit('login-respuesta', {
          success: false,
          error: 'Usuario o contraseña incorrectos'
        });
        console.log(`❌ Intento de login fallido: ${usuario}`);
      }
    } catch (error) {
      console.error('❌ Error al procesar login:', error);
      socket.emit('login-respuesta', {
        success: false,
        error: 'Error al procesar el login. Intente nuevamente.'
      });
    }
  });

  // ==================== VALIDAR TOKEN ====================
  socket.on('validar-token', (data) => {
    try {
      const { token } = data;
      
      if (!token) {
        socket.emit('validar-token-respuesta', {
          success: false,
          error: 'Token no proporcionado'
        });
        return;
      }
      
      const usuario = validarTokenSesion(token);
      
      if (usuario) {
        // Token válido - restaurar sesión
        socket.userLogin = {
          id: usuario.id,
          usuario: usuario.usuario,
          rol: usuario.rol,
          estado: usuario.estado
        };
        
        usuariosLogueados.set(socket.id, {
          usuario: usuario.usuario,
          rol: usuario.rol,
          estado: usuario.estado
        });
        
        socket.emit('validar-token-respuesta', {
          success: true,
          usuario: {
            id: usuario.id,
            usuario: usuario.usuario,
            rol: usuario.rol,
            estado: usuario.estado
          }
        });
        
        console.log(`✅ Token válido - Sesión restaurada para: ${usuario.usuario}`);
        
        // Si el usuario es conductor, notificar que está activo
        if (usuario.rol === 'conductor') {
          setImmediate(() => {
            io.emit('notificacion-conductor', {
              tipo: 'activo',
              usuario: usuario.usuario,
              mensaje: `Conductor: ${usuario.usuario} activo`
            });
            console.log(`📢 Notificación enviada: Conductor ${usuario.usuario} activo (token restaurado)`);
          });
        }
      } else {
        // Token inválido o expirado
        socket.emit('validar-token-respuesta', {
          success: false,
          error: 'Token inválido o expirado'
        });
        console.log(`❌ Token inválido o expirado`);
      }
    } catch (error) {
      console.error('❌ Error al validar token:', error);
      socket.emit('validar-token-respuesta', {
        success: false,
        error: 'Error al validar token'
      });
    }
  });

  // ==================== LOGOUT ====================
  socket.on('logout', (data) => {
    try {
      const { token } = data || {};
      
      // Invalidar token si se proporciona
      if (token) {
        invalidarTokenSesion(token);
        console.log('🗑️ Token invalidado');
      }
      
      if (socket.userLogin) {
        const usuario = socket.userLogin.usuario;
        const rol = socket.userLogin.rol;
        
        // Si el usuario es conductor, notificar a todos los usuarios conectados
        if (rol === 'conductor') {
          io.emit('notificacion-conductor', {
            tipo: 'inactivo',
            usuario: usuario,
            mensaje: `Conductor: ${usuario} inactivo`
          });
          console.log(`📢 Notificación enviada: Conductor ${usuario} inactivo`);
        }

        // Limpiar información del usuario del socket
        delete socket.userLogin;
        usuariosLogueados.delete(socket.id);
        console.log(`✅ Logout exitoso: ${usuario}`);
      }
      // Confirmar logout al cliente
      socket.emit('logout-respuesta', {
        success: true
      });
    } catch (error) {
      console.error('❌ Error al procesar logout:', error);
      socket.emit('logout-respuesta', {
        success: false,
        error: 'Error al cerrar sesión'
      });
    }
  });

  // ==================== UBICACIÓN DE CONDUCTORES ====================
  socket.on('ubicacion-conductor', async (data) => {
    try {
      // VALIDACIÓN ESTRICTA DE ESTRUCTURA
      if (!data || typeof data !== 'object') {
        console.warn('⚠️  Ubicación de conductor inválida: datos no es un objeto', data);
        return;
      }

      const { userId, lat, lng, speed, timestamp, accuracy } = data;

      // Función de validación y conversión de coordenadas
      const validarCoordenadas = (latVal, lngVal) => {
        // CAPA 1: Existencia
        if (latVal === undefined || latVal === null || lngVal === undefined || lngVal === null) {
          return null;
        }

        // CAPA 2: Conversión a número (maneja strings numéricos)
        let latNum, lngNum;
        if (typeof latVal === 'string') {
          latNum = parseFloat(latVal);
        } else if (typeof latVal === 'number') {
          latNum = latVal;
        } else {
          return null;
        }

        if (typeof lngVal === 'string') {
          lngNum = parseFloat(lngVal);
        } else if (typeof lngVal === 'number') {
          lngNum = lngVal;
        } else {
          return null;
        }

        // CAPA 3: Números finitos
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
          return null;
        }

        // CAPA 4: Punto nulo
        if (latNum === 0 && lngNum === 0) {
          return null;
        }

        // CAPA 5: Rangos válidos
        if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
          return null;
        }

        // CAPA 6: Valores casi cero
        if (Math.abs(latNum) < 0.000001 && Math.abs(lngNum) < 0.000001) {
          return null;
        }

        return { lat: latNum, lng: lngNum };
      };

      // Validar coordenadas
      const coordenadasValidas = validarCoordenadas(lat, lng);
      if (!coordenadasValidas) {
        console.warn('⚠️  Ubicación de conductor inválida: coordenadas no válidas', { lat, lng, tipoLat: typeof lat, tipoLng: typeof lng });
        return;
      }

      // CAPA 6: Validar accuracy si existe (descartar si > 200m)
      if (accuracy !== undefined && accuracy !== null) {
        if (!Number.isFinite(accuracy) || accuracy > 200) {
          console.warn('⚠️  Ubicación de conductor descartada: precisión GPS muy baja (>200m)', { lat, lng, accuracy });
          return;
        }
      }

      // Verificar que el usuario sea conductor
      if (!socket.userLogin || socket.userLogin.rol !== 'conductor') {
        console.warn('⚠️  Intento de enviar ubicación sin ser conductor');
        return;
      }

      const usuario = socket.userLogin.usuario;
      const conductorId = socket.userLogin.id?.toString() || userId || socket.id;

      // Usar coordenadas validadas
      const finalLat = coordenadasValidas.lat;
      const finalLng = coordenadasValidas.lng;
      
      // Validar y convertir otros valores
      const finalSpeed = (speed !== undefined && speed !== null && Number.isFinite(Number(speed))) ? Number(speed) : 0;
      const finalAccuracy = (accuracy !== undefined && accuracy !== null && Number.isFinite(Number(accuracy))) ? Number(accuracy) : undefined;
      const finalTimestamp = (timestamp !== undefined && timestamp !== null && Number.isFinite(Number(timestamp))) ? Number(timestamp) : Date.now();

      // Verificación final de seguridad (doble check)
      if (!Number.isFinite(finalLat) || !Number.isFinite(finalLng)) {
        console.error('❌ ERROR CRÍTICO: Coordenadas no finitas después de validación', { finalLat, finalLng });
        return;
      }

      // REGLA CRÍTICA DE BROADCAST: Reenvío INMEDIATO a TODOS los usuarios conectados
      // EXCEPTO al conductor emisor (usando socket.broadcast.emit)
      // Esto garantiza que la ubicación llegue a:
      // - Visitantes
      // - Trabajadores  
      // - Otros conductores
      // - Cualquier usuario activo en el servidor
      // NUNCA se envía de vuelta al propio emisor
      
      const ubicacionData = {
        conductorId: String(conductorId),
        usuario: String(usuario),
        lat: finalLat,
        lng: finalLng,
        speed: finalSpeed,
        accuracy: finalAccuracy,
        timestamp: finalTimestamp
      };
      
      // Reenviar ubicación a todos los usuarios conectados EXCEPTO al emisor
      socket.broadcast.emit('ubicacion-conductor', ubicacionData);
      
      // Obtener número de clientes conectados para logging (sin bloquear el reenvío)
      io.fetchSockets().then(sockets => {
        const otrosClientes = sockets.filter(s => s.id !== socket.id);
        console.log(`📡 Ubicación de conductor ${usuario} transmitida a ${otrosClientes.length} usuario(s) conectado(s)`);
      }).catch(err => {
        console.warn('⚠️ Error al obtener sockets para logging:', err);
        console.log(`📡 Ubicación de conductor ${usuario} transmitida`);
      });
      
      // Guardado en BD de forma asíncrona SIN bloquear el reenvío
      // (Si hay función de guardado, ejecutarla aquí de forma async)
    } catch (error) {
      console.error('❌ Error al procesar ubicación de conductor:', error, data);
    }
  });

  socket.on('disconnect', async () => {
    // Limpiar usuario logueado si existe
    if (socket.userLogin) {
      const usuario = socket.userLogin.usuario;
      const rol = socket.userLogin.rol;
      
      // Si el usuario es conductor, notificar a todos los usuarios conectados
      if (rol === 'conductor') {
        io.emit('notificacion-conductor', {
          tipo: 'inactivo',
          usuario: usuario,
          mensaje: `Conductor: ${usuario} inactivo`
        });
        console.log(`📢 Notificación enviada (disconnect): Conductor ${usuario} inactivo`);
      }
      
      usuariosLogueados.delete(socket.id);
    }

    const userId = socket.userId || null;
    
    if (userId) {
      // Verificar si el usuario tiene otro socket activo (reconexión rápida)
      const socketActual = userSocketMap.get(userId);
      
      // Solo procesar desconexión si este es el socket actual del usuario
      if (socketActual === socket.id) {
        // Remover del mapa de usuarios conectados
        userSocketMap.delete(userId);
        // Remover de usuarios notificados para permitir notificación en próxima conexión
        usuariosNotificados.delete(userId);
        // Remover la ubicación del usuario desconectado
        ultimasUbicaciones.delete(userId);
        
        // Usar la información del usuario guardada en el socket (no consultar BD)
        const userInfo = socket.userInfo || {};
        if (userInfo.numUsuario || userInfo.plataforma) {
          // Notificar a otros usuarios que alguien se desconectó
          socket.broadcast.emit('cliente-desconectado', {
            userId: userId,
            numUsuario: userInfo.numUsuario || null,
            nombre: userInfo.nombre || null,
            plataforma: userInfo.plataforma || 'web',
            timestamp: new Date().toISOString()
          });
          console.log(`❌ Usuario desconectado: ${userId} (${userInfo.plataforma || 'web'}) - Número: ${userInfo.numUsuario || 'N/A'}`);
        }
      } else {
        console.log(`🔄 Socket antiguo eliminado: ${socket.id} (Usuario: ${userId} ya tiene nuevo socket)`);
      }
    } else {
      console.log(`❌ Cliente desconectado: ${socket.id} (Usuario desconocido)`);
    }
  });
});

/**
 * Función helper para emitir eventos a todos excepto al usuario especificado
 */
async function emitToOthers(userId, event, data) {
  if (!userId) {
    // Si no hay userId, emitir a todos (compatibilidad hacia atrás)
    io.emit(event, data);
    return;
  }

  // Obtener todos los sockets conectados
  const sockets = await io.fetchSockets();
  sockets.forEach(socket => {
    if (socket.userId !== userId) {
      socket.emit(event, data);
    }
  });
}

// Middleware para manejar errores de payload demasiado grande (debe ir después de todas las rutas)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413 || err.message?.includes('too large') || err.name === 'PayloadTooLargeError') {
    return res.status(413).json({
      success: false,
      error: `Payload demasiado grande. Límite actual: ${JSON_LIMIT}. El archivo debe ser más pequeño.`,
      limit: JSON_LIMIT
    });
  }
  // Pasar otros errores al siguiente middleware
  next(err);
});

// Manejo de errores del proceso
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor...');
  closeDatabase();
  httpServer.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
});

// Iniciar servidor
// Limpiar tokens expirados al iniciar y cada hora
limpiarTokensExpirados();
setInterval(() => {
  limpiarTokensExpirados();
}, 3600000); // Cada hora

httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor Fleet Tracking iniciado en puerto ${PORT}`);
  console.log(`📡 Socket.IO disponible en http://localhost:${PORT}`);
  console.log(`🌐 API REST disponible en http://localhost:${PORT}/api`);
  console.log(`📦 Límite de JSON: ${JSON_LIMIT}`);
  console.log(`🌍 Orígenes CORS permitidos: ${CORS_ORIGINS.join(', ')}`);
  console.log(`🔐 Sistema de tokens de sesión activo`);
});


