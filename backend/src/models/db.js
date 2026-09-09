const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(20) NOT NULL DEFAULT 'consulta',
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS facturas (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(100) NOT NULL,
        tipo VARCHAR(5) NOT NULL CHECK (tipo IN ('FE', 'NC')),
        cufe VARCHAR(255),
        proveedor_nombre VARCHAR(200) NOT NULL,
        proveedor_nit VARCHAR(50) NOT NULL,
        fecha_emision DATE NOT NULL,
        fecha_vencimiento DATE,
        subtotal NUMERIC(18,2) DEFAULT 0,
        iva NUMERIC(18,2) DEFAULT 0,
        total NUMERIC(18,2) NOT NULL,
        estado VARCHAR(30) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesado', 'reenviado')),
        reenviado_a VARCHAR(150),
        gmail_message_id VARCHAR(255) UNIQUE,
        estado_contable VARCHAR(50) DEFAULT 'por_gestionar',
        documento_ingreso VARCHAR(100),
        pdf_path VARCHAR(500),
        xml_path VARCHAR(500),
        xml_raw TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS productos_factura (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        codigo VARCHAR(100),
        descripcion TEXT NOT NULL,
        cantidad NUMERIC(10,3) NOT NULL,
        precio_unitario NUMERIC(18,2) NOT NULL,
        total NUMERIC(18,2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contactos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        cargo VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS responsables_factura (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        email VARCHAR(150) NOT NULL,
        nombre VARCHAR(150),
        UNIQUE(factura_id, email)
      );

      CREATE TABLE IF NOT EXISTS reenvios_log (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
        enviado_por INTEGER REFERENCES usuarios(id),
        destinatarios TEXT NOT NULL,
        fecha TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS configuracion (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(100) UNIQUE NOT NULL,
        valor TEXT NOT NULL
      );

      -- Migraciones para DBs existentes
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS documento_ingreso VARCHAR(100);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS documento_ingreso VARCHAR(100);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS notas TEXT;
      -- constraint manejado por Supabase directamente
      
      ALTER TABLE responsables_factura ADD COLUMN IF NOT EXISTS nombre VARCHAR(150);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS es_contrato BOOLEAN DEFAULT false;
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS flujo_tipo VARCHAR(30);
      INSERT INTO configuracion (clave, valor) VALUES ('sync_desde', '') ON CONFLICT (clave) DO NOTHING;
      INSERT INTO configuracion (clave, valor) VALUES ('sync_interval_hours', '0') ON CONFLICT (clave) DO NOTHING;
      ALTER TABLE facturas ALTER COLUMN estado_contable SET DEFAULT 'por_gestionar';
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema VARCHAR(50) DEFAULT 'oscuro';
      CREATE TABLE IF NOT EXISTS contactos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        cargo VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Tablas de préstamos
      CREATE TABLE IF NOT EXISTS clinicas_prestamo (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        ciudad VARCHAR(100),
        contacto VARCHAR(150),
        telefono VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS productos_prestamo (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(100) UNIQUE NOT NULL,
        nombre VARCHAR(200) NOT NULL,
        unidad VARCHAR(50) DEFAULT 'Unidad',
        precio_unitario NUMERIC(18,2) DEFAULT 0,
        categoria VARCHAR(50) DEFAULT 'medicamento',
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS prestamos (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('dado', 'recibido')),
        clinica_id INTEGER REFERENCES clinicas_prestamo(id),
        clinica_nombre VARCHAR(200),
        fecha DATE NOT NULL,
        documento_contable VARCHAR(100),
        pdf_path VARCHAR(500),
        estado VARCHAR(30) DEFAULT 'abierto' CHECK (estado IN ('abierto', 'parcial', 'cerrado')),
        fecha_cierre DATE,
        notas TEXT,
        creado_por INTEGER REFERENCES usuarios(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS items_prestamo (
        id SERIAL PRIMARY KEY,
        prestamo_id INTEGER REFERENCES prestamos(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos_prestamo(id),
        codigo VARCHAR(100),
        nombre VARCHAR(200) NOT NULL,
        unidad VARCHAR(50),
        cantidad NUMERIC(10,3) NOT NULL,
        precio_unitario NUMERIC(18,2) DEFAULT 0,
        cantidad_devuelta NUMERIC(10,3) DEFAULT 0
      );

      -- Cruces entre préstamos y devoluciones (soporta multicruce: N préstamos <-> M devoluciones)
      CREATE TABLE IF NOT EXISTS prestamo_cruces (
        id SERIAL PRIMARY KEY,
        prestamo_id INTEGER REFERENCES prestamos(id),
        devolucion_id INTEGER REFERENCES prestamos(id),
        tipo_cruce VARCHAR(20) DEFAULT 'total',
        observaciones TEXT,
        soporte_url VARCHAR(500),
        soporte_items JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Grupo de cruce: agrupa uno o varios pares préstamo/devolución bajo un mismo consecutivo y PDF
      CREATE TABLE IF NOT EXISTS cruce_grupos (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(30) UNIQUE NOT NULL,
        observaciones TEXT,
        pdf_url VARCHAR(500),
        creado_por INTEGER REFERENCES usuarios(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE SEQUENCE IF NOT EXISTS cruce_consecutivo_seq START 1;
      ALTER TABLE prestamo_cruces ADD COLUMN IF NOT EXISTS grupo_id INTEGER REFERENCES cruce_grupos(id) ON DELETE CASCADE;

      -- Asignación real por producto: qué cantidad exacta de cada código se
      -- cruzó entre ESTE préstamo y ESTA devolución puntual (registrada desde
      -- el panel de "Cruzar" con selección item por item / multicruce). Es
      -- JSONB con forma [{ codigo, nombre, cantidad, precio_unitario }, ...].
      -- Los cruces creados antes de este cambio quedan con este campo en NULL
      -- (se sigue tratando como antes: se asume el documento contrario completo).
      ALTER TABLE prestamo_cruces ADD COLUMN IF NOT EXISTS items_cruzados JSONB;

      -- Marca a nivel de grupo (no por par individual) cuando, al registrar el
      -- cruce, quedaron unidades de algún producto de una devolución sin
      -- asignar a ningún préstamo — para poder avisarlo en el historial y
      -- listarlo aparte en "Devoluciones con sobrante".
      ALTER TABLE cruce_grupos ADD COLUMN IF NOT EXISTS tiene_sobrante BOOLEAN DEFAULT false;
      ALTER TABLE cruce_grupos ADD COLUMN IF NOT EXISTS sobrante_detalle JSONB;

      -- Reparación de consecutivos duplicados en cruce_grupos: la tabla se creó
      -- originalmente sin una restricción UNIQUE real sobre "numero" (el UNIQUE
      -- del CREATE TABLE de arriba no se aplica retroactivamente a una tabla
      -- que ya existía), así que quedaron cruces con el mismo CRU-xxxxx. Este
      -- bloque renumera los duplicados (conserva el más antiguo con su número
      -- original), sincroniza la secuencia y recién ahí aplica la restricción
      -- real — es idempotente, así que no pasa nada si corre en cada arranque.
      DO $$
      DECLARE
        dup RECORD;
        id_dup INTEGER;
        nuevo_n BIGINT;
      BEGIN
        -- Sincronizar la secuencia con el máximo consecutivo real ANTES de
        -- renumerar nada: si esto se hiciera después, nextval() podría
        -- devolver un número que ya existe a mano (que es justo lo que
        -- desincronizó la secuencia en primer lugar) y generaría un
        -- duplicado nuevo mientras arregla el viejo.
        PERFORM setval('cruce_consecutivo_seq',
          GREATEST(
            (SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM 5) AS INTEGER)), 0) FROM cruce_grupos WHERE numero ~ '^CRU-[0-9]+$'),
            (SELECT last_value FROM cruce_consecutivo_seq)
          )
        );

        FOR dup IN
          SELECT numero, (array_agg(id ORDER BY id))[2:] AS ids_extra
          FROM cruce_grupos
          GROUP BY numero
          HAVING COUNT(*) > 1
        LOOP
          FOREACH id_dup IN ARRAY dup.ids_extra LOOP
            nuevo_n := nextval('cruce_consecutivo_seq');
            UPDATE cruce_grupos SET numero = 'CRU-' || LPAD(nuevo_n::TEXT, 5, '0') WHERE id = id_dup;
            RAISE NOTICE 'CRU duplicado reparado: grupo id=% paso de % a CRU-%', id_dup, dup.numero, LPAD(nuevo_n::TEXT, 5, '0');
          END LOOP;
        END LOOP;

        -- Restricción UNIQUE real, ya sin duplicados
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'cruce_grupos_numero_unique'
        ) THEN
          ALTER TABLE cruce_grupos ADD CONSTRAINT cruce_grupos_numero_unique UNIQUE (numero);
        END IF;
      END $$;

      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS alias VARCHAR(50);

      -- Tabla estado de productos por factura (pendientes)
      CREATE TABLE IF NOT EXISTS productos_factura_estado (
        id                SERIAL PRIMARY KEY,
        factura_id        INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        producto_id       INTEGER NOT NULL REFERENCES productos_factura(id) ON DELETE CASCADE,
        cantidad_recibida NUMERIC,
        nota              TEXT,
        revisado_por      INTEGER REFERENCES usuarios(id),
        updated_at        TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(factura_id, producto_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pfe_factura ON productos_factura_estado(factura_id);
      ALTER TABLE productos_factura_estado ADD COLUMN IF NOT EXISTS tipo_problema VARCHAR(30);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(100);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS origen VARCHAR(20) DEFAULT 'gmail';
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tiene_gmail BOOLEAN DEFAULT false;
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS gmail_factura_id INTEGER REFERENCES facturas(id) ON DELETE SET NULL;
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS notificacion_vista BOOLEAN DEFAULT true;
      UPDATE facturas SET origen = 'gmail' WHERE origen IS NULL;

      -- Productos que llegaron pero no están en la factura
      CREATE TABLE IF NOT EXISTS productos_no_facturados (
        id              SERIAL PRIMARY KEY,
        factura_id      INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        descripcion     TEXT NOT NULL,
        cantidad        NUMERIC,
        tipo_problema   VARCHAR(30) DEFAULT 'no_facturado',
        nota            TEXT,
        registrado_por  INTEGER REFERENCES usuarios(id),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pnf_factura ON productos_no_facturados(factura_id);

      INSERT INTO configuracion (clave, valor) VALUES
        ('sync_interval_hours', '2'),
        ('gmail_connected', 'false'),
        ('gmail_account', ''),
        ('gmail_refresh_token', ''),
        ('auto_process_xml', 'true'),
        ('notify_on_new', 'true'),
        ('palabras_clave', 'factura electrónica,nota crédito,DIAN,FE-')
      ON CONFLICT (clave) DO NOTHING;

      -- Validador de Inventarios: conteo físico de bodega vs sistema (SIIS)
      -- La unicidad por (bodega, codigo, lote, fecha_vencimiento) permite reemplazar
      -- el Excel del sistema sin perder el avance de los items ya contados (UPSERT
      -- solo actualiza nombre/existencia_sistema, nunca toca cantidad_fisica/contado).
      CREATE TABLE IF NOT EXISTS validador_inventario (
        id                  SERIAL PRIMARY KEY,
        bodega              VARCHAR(10) NOT NULL DEFAULT 'BV',
        codigo              VARCHAR(50) NOT NULL,
        nombre              VARCHAR(300) NOT NULL,
        lote                VARCHAR(100) NOT NULL DEFAULT '',
        fecha_vencimiento   VARCHAR(20) NOT NULL DEFAULT '',
        existencia_sistema  NUMERIC(14,3) NOT NULL DEFAULT 0,
        costo_unitario      NUMERIC(18,2) NOT NULL DEFAULT 0,
        costo_total         NUMERIC(18,2) NOT NULL DEFAULT 0,
        cantidad_fisica     NUMERIC(14,3),
        contado             BOOLEAN DEFAULT false,
        contado_por         INTEGER REFERENCES usuarios(id),
        contado_en          TIMESTAMP,
        sin_existencias     BOOLEAN DEFAULT false,
        sin_existencias_desde TIMESTAMPTZ,
        ultima_carga        TIMESTAMPTZ,
        actualizado_en      TIMESTAMP DEFAULT NOW(),
        UNIQUE(bodega, codigo, lote, fecha_vencimiento)
      );
      CREATE INDEX IF NOT EXISTS idx_vi_bodega ON validador_inventario(bodega);

      -- Migraciones para instancias existentes (agrega columnas si no existen)
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='costo_unitario') THEN
          ALTER TABLE validador_inventario ADD COLUMN costo_unitario NUMERIC(18,2) NOT NULL DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='costo_total') THEN
          ALTER TABLE validador_inventario ADD COLUMN costo_total NUMERIC(18,2) NOT NULL DEFAULT 0;
        END IF;
      END $$;

      -- Ampliar 'nombre' a TEXT: los reportes SIIS a veces traen descripciones
      -- de producto (nombre + presentación + concentración + laboratorio) que
      -- superan varchar(300), causando el error Postgres 22001 al importar.
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='validador_inventario' AND column_name='nombre' AND data_type='character varying'
        ) THEN
          ALTER TABLE validador_inventario ALTER COLUMN nombre TYPE TEXT;
        END IF;
      END $$;

      -- 'sin_existencias' + 'ultima_carga': si un ítem no viene en la última
      -- importación de Excel para su bodega, se marca sin_existencias = true
      -- (sin borrarlo, conserva el historial de conteo). ultima_carga guarda
      -- la fecha en que el ítem fue visto por última vez en un Excel subido.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='sin_existencias') THEN
          ALTER TABLE validador_inventario ADD COLUMN sin_existencias BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='ultima_carga') THEN
          ALTER TABLE validador_inventario ADD COLUMN ultima_carga TIMESTAMPTZ;
        END IF;
      END $$;

      -- 'sin_existencias_desde': se llena SOLO la primera vez que un ítem deja
      -- de aparecer en una carga (trazabilidad de cuándo desapareció). Si vuelve
      -- a aparecer en el sistema, se limpia; si vuelve a desaparecer más tarde,
      -- se vuelve a fijar con la fecha de esa nueva ausencia.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='sin_existencias_desde') THEN
          ALTER TABLE validador_inventario ADD COLUMN sin_existencias_desde TIMESTAMPTZ;
        END IF;
      END $$;

      -- 'sobrante_libro': registro MANUAL (no calculado) de sobrantes antiguos
      -- que vienen de antes de que existiera el control de inventario físico.
      -- No se calcula solo porque las diferencias reales suelen deberse a
      -- errores en salidas de consumo, no a un sobrante real del producto.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='sobrante_libro') THEN
          ALTER TABLE validador_inventario ADD COLUMN sobrante_libro NUMERIC(14,3);
        END IF;
      END $$;

      -- 'tipo_diferencia': clasificación MANUAL de la diferencia ('real' o
      -- 'actualizacion'), elegida por el usuario. Es persistente: el UPSERT de
      -- /importar NUNCA la toca, así que sobrevive a nuevas cargas de Excel
      -- hasta que alguien la cambie explícitamente.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='tipo_diferencia') THEN
          ALTER TABLE validador_inventario ADD COLUMN tipo_diferencia VARCHAR(20);
        END IF;
      END $$;

      -- 'notas': texto libre MANUAL para observaciones por ítem. Igual que
      -- sobrante_libro y tipo_diferencia, el UPSERT de /importar nunca la
      -- toca, así que persiste entre cargas de Excel.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='validador_inventario' AND column_name='notas') THEN
          ALTER TABLE validador_inventario ADD COLUMN notas TEXT;
        END IF;
      END $$;

      -- 'tipos_inventario': tabla de mapeo CONCAT (grupo+clase+subclase, o
      -- código alfabético de excepción) -> cuenta contable. Se usa para
      -- agrupar el Validador de Inventarios por tipo de artículo.
      CREATE TABLE IF NOT EXISTS tipos_inventario (
        concat    VARCHAR(6) PRIMARY KEY,
        contable  VARCHAR(30) NOT NULL,
        cuenta    VARCHAR(100) NOT NULL
      );

      -- Extrae el CONCAT (6 caracteres) desde el código real del artículo.
      -- Numérico de 10 dígitos -> los primeros 6 tal cual.
      -- Numérico de 9 dígitos  -> le falta el 0 a la izquierda del grupo,
      --                           se rellena a 10 y luego se toman los primeros 6.
      -- Alfabético              -> se usa tal cual (códigos de excepción).
      CREATE OR REPLACE FUNCTION concat_tipo_inventario(p_codigo TEXT)
      RETURNS TEXT AS $FN$
      DECLARE
        c TEXT := trim(p_codigo);
      BEGIN
        IF c ~ '^[0-9]+$' THEN
          IF length(c) = 9 THEN
            c := lpad(c, 10, '0');
          END IF;
          RETURN left(c, 6);
        ELSE
          RETURN upper(c);
        END IF;
      END;
      $FN$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Semilla / actualización de tipos_inventario (idempotente vía ON CONFLICT)
    await client.query(`
      INSERT INTO tipos_inventario (concat, contable, cuenta) VALUES
      ('010101','14150501','MEDICAMENTOS'),('010102','14150501','MEDICAMENTOS'),
      ('010103','14150501','MEDICAMENTOS'),('010104','14150501','MEDICAMENTOS'),
      ('010105','14150501','MEDICAMENTOS'),('010106','14150501','MEDICAMENTOS'),
      ('010107','14150501','MEDICAMENTOS'),('010108','14150501','MEDICAMENTOS'),
      ('010201','14150501','MEDICAMENTOS'),('010202','14150501','MEDICAMENTOS'),
      ('010203','14150501','MEDICAMENTOS'),('010204','14150501','MEDICAMENTOS'),
      ('010205','14150501','MEDICAMENTOS'),('010206','14150501','MEDICAMENTOS'),
      ('010207','14150501','MEDICAMENTOS'),('010208','14150501','MEDICAMENTOS'),
      ('010209','14150501','MEDICAMENTOS'),('010210','14150501','MEDICAMENTOS'),
      ('010211','14150501','MEDICAMENTOS'),('010212','14150501','MEDICAMENTOS'),
      ('010213','14150501','MEDICAMENTOS'),('010214','14150501','MEDICAMENTOS'),
      ('010215','14150501','MEDICAMENTOS'),('010216','14150501','MEDICAMENTOS'),
      ('010217','14150501','MEDICAMENTOS'),('010218','14150501','MEDICAMENTOS'),
      ('010301','14150501','MEDICAMENTOS'),('010302','14150501','MEDICAMENTOS'),
      ('010304','14150501','MEDICAMENTOS'),('010305','14150501','MEDICAMENTOS'),
      ('010401','14150501','MEDICAMENTOS'),('140101','NO APLICA','NO APLICA'),
      ('150101','14230501','GLOBULOS ROJOS'),('150202','14230502','PLASMA'),
      ('150303','14230503','PLAQUETAS'),('150401','14230504','CRIOPRECIPITADOS'),
      ('160101','14554001','MATERIALES DE CONSTRUCCION'),
      ('160102','14554002','SISTEMAS COMPLEMENTARIOS'),
      ('160103','14554005','MOBILIARIO COMPLEMENTARIO'),
      ('160201','14552501','REPUESTOS Y ELEMENTOS DE MANTENIMIENTO'),
      ('160202','NO APLICA','NO APLICA'),('160203','NO APLICA','NO APLICA'),
      ('160204','14552501','REPUESTOS Y ELEMENTOS DE MANTENIMIENTO'),
      ('170101','15882406','MUEBLES Y ENSERES'),
      ('170201','15883205','EQUIPO MEDICO CIENTIFICO'),
      ('170301','15882806','EQUIPO DE PROCESAMIENTO DE DATOS'),
      ('170302','15882811','EQUIPO DE TELECOMUNICACIONES'),
      ('170401','15882005','MAQUINARIA Y EQUIPO'),
      ('170402','14554003','HERRAMIENTAS MANUALES'),
      ('170403','14554004','EQUIPOS DE MENOR VALOR'),
      ('170501','15884091','ASISTENCIAL'),('170502','15884092','ADMINISTRATIVO'),
      ('170601','14556001','AMV EQUIPOS DE OFICINA'),
      ('170602','14556002','AMV EQUIPO MEDICO CIENTIFICO'),
      ('170603','14556003','PROCESAMIENTO DE DATOS'),
      ('170604','14556004','AMV MAQUINARIA Y EQUIPO'),
      ('020101','14200501','DISPOSITIVOS MEDICOS'),('020102','14200501','DISPOSITIVOS MEDICOS'),
      ('020103','14200501','DISPOSITIVOS MEDICOS'),('020201','14200501','DISPOSITIVOS MEDICOS'),
      ('020202','14200501','DISPOSITIVOS MEDICOS'),('020203','14200501','DISPOSITIVOS MEDICOS'),
      ('020204','14200501','DISPOSITIVOS MEDICOS'),('020301','14200501','DISPOSITIVOS MEDICOS'),
      ('020302','14200501','DISPOSITIVOS MEDICOS'),('020303','14200501','DISPOSITIVOS MEDICOS'),
      ('020401','14200501','DISPOSITIVOS MEDICOS'),('020403','14200501','DISPOSITIVOS MEDICOS'),
      ('020501','14200501','DISPOSITIVOS MEDICOS'),('020601','14200501','DISPOSITIVOS MEDICOS'),
      ('020701','14200501','DISPOSITIVOS MEDICOS'),('020801','14200501','DISPOSITIVOS MEDICOS'),
      ('020901','14200501','DISPOSITIVOS MEDICOS'),('021001','14200501','DISPOSITIVOS MEDICOS'),
      ('021002','14200501','DISPOSITIVOS MEDICOS'),('021003','14200501','DISPOSITIVOS MEDICOS'),
      ('021101','14200501','DISPOSITIVOS MEDICOS'),('021102','14200501','DISPOSITIVOS MEDICOS'),
      ('021103','14200501','DISPOSITIVOS MEDICOS'),('021104','14200501','DISPOSITIVOS MEDICOS'),
      ('021105','14200501','DISPOSITIVOS MEDICOS'),('021106','14200501','DISPOSITIVOS MEDICOS'),
      ('021107','14200501','DISPOSITIVOS MEDICOS'),('021108','14200501','DISPOSITIVOS MEDICOS'),
      ('021201','14200501','DISPOSITIVOS MEDICOS'),('021301','14200501','DISPOSITIVOS MEDICOS'),
      ('021401','14200501','DISPOSITIVOS MEDICOS'),('021402','14200501','DISPOSITIVOS MEDICOS'),
      ('021403','14200501','DISPOSITIVOS MEDICOS'),('021404','14200501','DISPOSITIVOS MEDICOS'),
      ('021501','14200501','DISPOSITIVOS MEDICOS'),('021502','14200501','DISPOSITIVOS MEDICOS'),
      ('021601','14200501','DISPOSITIVOS MEDICOS'),('021701','14200501','DISPOSITIVOS MEDICOS'),
      ('021702','14200501','DISPOSITIVOS MEDICOS'),('021703','14200501','DISPOSITIVOS MEDICOS'),
      ('021704','14200501','DISPOSITIVOS MEDICOS'),('021705','14200501','DISPOSITIVOS MEDICOS'),
      ('021706','14200501','DISPOSITIVOS MEDICOS'),('021707','14200501','DISPOSITIVOS MEDICOS'),
      ('021708','14200501','DISPOSITIVOS MEDICOS'),('021801','14200501','DISPOSITIVOS MEDICOS'),
      ('021802','14200501','DISPOSITIVOS MEDICOS'),('021803','14200501','DISPOSITIVOS MEDICOS'),
      ('021804','14200501','DISPOSITIVOS MEDICOS'),('021805','14200501','DISPOSITIVOS MEDICOS'),
      ('021806','14200501','DISPOSITIVOS MEDICOS'),('021807','14200501','DISPOSITIVOS MEDICOS'),
      ('021808','14200501','DISPOSITIVOS MEDICOS'),('021809','14200501','DISPOSITIVOS MEDICOS'),
      ('021901','14200501','DISPOSITIVOS MEDICOS'),('022001','14200501','DISPOSITIVOS MEDICOS'),
      ('022101','14200501','DISPOSITIVOS MEDICOS'),('022102','14200501','DISPOSITIVOS MEDICOS'),
      ('022201','14200501','DISPOSITIVOS MEDICOS'),('022202','14200501','DISPOSITIVOS MEDICOS'),
      ('022203','14200501','DISPOSITIVOS MEDICOS'),('022301','14200501','DISPOSITIVOS MEDICOS'),
      ('022401','14200501','DISPOSITIVOS MEDICOS'),('022402','14200501','DISPOSITIVOS MEDICOS'),
      ('022501','14200501','DISPOSITIVOS MEDICOS'),('022601','14200501','DISPOSITIVOS MEDICOS'),
      ('022602','14200501','DISPOSITIVOS MEDICOS'),('022603','14200501','DISPOSITIVOS MEDICOS'),
      ('022701','14200501','DISPOSITIVOS MEDICOS'),('022801','14200501','DISPOSITIVOS MEDICOS'),
      ('022901','14200501','DISPOSITIVOS MEDICOS'),('023001','14200501','DISPOSITIVOS MEDICOS'),
      ('023002','14200501','DISPOSITIVOS MEDICOS'),('023003','14200501','DISPOSITIVOS MEDICOS'),
      ('023004','14200501','DISPOSITIVOS MEDICOS'),('023005','14200501','DISPOSITIVOS MEDICOS'),
      ('023006','14200501','DISPOSITIVOS MEDICOS'),('023007','14200501','DISPOSITIVOS MEDICOS'),
      ('023008','14200501','DISPOSITIVOS MEDICOS'),('023101','14200501','DISPOSITIVOS MEDICOS'),
      ('023201','14200501','DISPOSITIVOS MEDICOS'),('023301','14200501','DISPOSITIVOS MEDICOS'),
      ('023302','14200501','DISPOSITIVOS MEDICOS'),('023303','14200501','DISPOSITIVOS MEDICOS'),
      ('023304','14200501','DISPOSITIVOS MEDICOS'),('023401','14200501','DISPOSITIVOS MEDICOS'),
      ('023501','14200501','DISPOSITIVOS MEDICOS'),('023502','14200501','DISPOSITIVOS MEDICOS'),
      ('023601','14200501','DISPOSITIVOS MEDICOS'),('023701','14200501','DISPOSITIVOS MEDICOS'),
      ('210101','14150501','MEDICAMENTOS'),('030101','14151001','COMPLEMENTOS NUTRICIONALES'),
      ('220102','14200501','DISPOSITIVOS MEDICOS'),('260104','14210301','LABORATORIO CLINICO'),
      ('030201','14151001','COMPLEMENTOS NUTRICIONALES'),('030202','14151001','COMPLEMENTOS NUTRICIONALES'),
      ('040101','14220501','MATERIALES ODONTOLOGICOS'),
      ('040102','14552001','ELEMENTOS DE ASEO Y CAFETERIA'),
      ('040103','14200501','DISPOSITIVOS MEDICOS'),
      ('040104','14550501','ELEMENTOS DE PAPELERIA'),
      ('040105','14554501','ELEMENTOS DE REHABILITACION Y TERAPIA'),
      ('040106','14555501','REPUESTOS DATOS Y COMUNICACION'),
      ('060101','APROVECHAMIENTOS INSUMOS','APROVECHAMIENTOS INSUMOS'),
      ('070101','14210101','GASES MEDICINALES'),('070202','14210201','GASES ARTERIALES'),
      ('070303','14210301','LABORATORIO CLINICO'),('070305','14210301','LABORATORIO CLINICO'),
      ('070404','NO APLICA','NO APLICA'),('080101','14151001','COMPLEMENTOS NUTRICIONALES'),
      ('080201','14151001','COMPLEMENTOS NUTRICIONALES'),('080202','14151001','COMPLEMENTOS NUTRICIONALES'),
      ('290101','14150501','MEDICAMENTOS'),
      ('ACASDS','14552001','ELEMENTOS DE ASEO Y CAFETERIA'),
      ('ACASHD','14552001','ELEMENTOS DE ASEO Y CAFETERIA'),
      ('ACCFCO','14552002','ELEMENTOS DE CAFETERIA'),
      ('ACCFDE','14552002','ELEMENTOS DE CAFETERIA'),
      ('ACVAVA','NO APLICA','NO APLICA'),
      ('DOINBA','14551001','UNIFORMES'),('DOINCA','14551002','CALZADO'),
      ('DOINUN','14551001','UNIFORMES'),
      ('EFEE04','14552501','REPUESTOS Y ELEMENTOS DE MANTENIMIENTO'),
      ('EFSF05','14552501','REPUESTOS Y ELEMENTOS DE MANTENIMIENTO'),
      ('EMAMAM','14555002','ACCESORIOS MAQUINARIA Y EQ MEDICO'),
      ('EMRMRM','14555001','REPUESTOS MAQUINARIA Y EQ MEDICO CIENTIF'),
      ('FOFOFO','NO VALIDO','NO VALIDO'),
      ('RPRPRP','14551501','ROPA HOSPITALARIA Y QUIRURGICA'),
      ('SOESIN','14551003','ELEMENTOS DE PROTECCION PERSONAL'),
      ('SOSEIN','14551003','ELEMENTOS DE PROTECCION PERSONAL'),
      ('UPFIFM','NO APLICA','NO APLICA'),
      ('UPPIIN','14550501','ELEMENTOS DE PAEPELERIA'),
      ('UPUEIN','14550501','ELEMENTOS DE PAEPELERIA')
      ON CONFLICT (concat) DO UPDATE SET
        contable = EXCLUDED.contable,
        cuenta   = EXCLUDED.cuenta;

      -- 'presentaciones_inventario': presentación del artículo (ej. "Caja x100",
      -- "Frasco 500ml"). Es una propiedad del CÓDIGO en sí, no de una fila
      -- bodega+lote, así que va en tabla aparte (no se duplica por lote) y se
      -- carga/edita de forma independiente al Excel de inventario (SIIS).
      -- Solo admin puede subir el Excel de presentaciones o editarlas a mano.
      CREATE TABLE IF NOT EXISTS presentaciones_inventario (
        codigo          VARCHAR(50) PRIMARY KEY,
        presentacion    VARCHAR(200) NOT NULL DEFAULT '',
        actualizado_por INTEGER REFERENCES usuarios(id),
        actualizado_en  TIMESTAMP DEFAULT NOW()
      );

      -- Grupo de inventario "físico": los primeros 2 dígitos del CONCAT para
      -- códigos numéricos (nivel más amplio que la cuenta contable, que puede
      -- agrupar varios grupos bajo un mismo nombre contable); para códigos
      -- alfabéticos de excepción, el grupo es el código completo.
      CREATE OR REPLACE FUNCTION grupo_inventario(p_codigo TEXT)
      RETURNS TEXT AS $FN2$
      DECLARE
        c TEXT := concat_tipo_inventario(p_codigo);
      BEGIN
        IF c ~ '^[0-9]+$' THEN
          RETURN left(c, 2);
        ELSE
          RETURN c;
        END IF;
      END;
      $FN2$ LANGUAGE plpgsql IMMUTABLE;

      -- ── Listas de conteo ──────────────────────────────────────────────────
      -- Una lista = una sesión de conteo físico sobre un subconjunto de una
      -- bodega (general, por cuenta contable, por grupo de inventario o por
      -- presentación). Los ítems se "congelan" (snapshot) al crearla, para
      -- que no se muevan bajo los pies de quien está contando si mientras
      -- tanto se sube un Excel nuevo de SIIS.
      CREATE TABLE IF NOT EXISTS listas_conteo (
        id                          SERIAL PRIMARY KEY,
        bodega                      VARCHAR(5) NOT NULL,
        tipo                        VARCHAR(20) NOT NULL, -- general | cuenta_contable | grupo_inventario | presentacion
        criterio                    VARCHAR(150),          -- valor elegido (nombre de cuenta, grupo o presentación); NULL si es general
        subclasificar_presentacion  BOOLEAN NOT NULL DEFAULT false,
        conteo1_nombre              VARCHAR(100),
        conteo2_nombre              VARCHAR(100),
        estado                      VARCHAR(10) NOT NULL DEFAULT 'abierta', -- abierta | cerrada
        creado_por                  INTEGER REFERENCES usuarios(id),
        creado_en                   TIMESTAMP DEFAULT NOW(),
        cerrado_por                 INTEGER REFERENCES usuarios(id),
        cerrado_en                  TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS listas_conteo_items (
        id                 SERIAL PRIMARY KEY,
        lista_id           INTEGER NOT NULL REFERENCES listas_conteo(id) ON DELETE CASCADE,
        codigo             VARCHAR(50) NOT NULL,
        nombre             VARCHAR(300),
        lote               VARCHAR(100),
        fecha_vencimiento  VARCHAR(20),
        presentacion       VARCHAR(200),
        cuenta             VARCHAR(100),
        existencia_siis    NUMERIC(14,3) DEFAULT 0,  -- snapshot al crear la lista
        costo_unitario     NUMERIC(14,3) DEFAULT 0,  -- snapshot
        conteo_1           NUMERIC(14,3),
        conteo_1_por       INTEGER REFERENCES usuarios(id),
        conteo_1_en        TIMESTAMP,
        conteo_2           NUMERIC(14,3),
        conteo_2_por       INTEGER REFERENCES usuarios(id),
        conteo_2_en        TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_listas_conteo_items_lista ON listas_conteo_items(lista_id);

      -- 'concat' del ítem al momento del snapshot: permite reclasificar una
      -- fila "SIN CLASIFICAR" directo desde una lista de conteo ya creada,
      -- sin depender de recalcular el código cada vez.
      ALTER TABLE listas_conteo_items ADD COLUMN IF NOT EXISTS concat VARCHAR(10);
      UPDATE listas_conteo_items SET concat = concat_tipo_inventario(codigo) WHERE concat IS NULL;
    `);

    // Migraciones de roles — queries separadas para que los UPDATE surtan efecto antes del constraint
    // Migrar roles viejos si existen (sin tocar el constraint)
    await client.query("UPDATE usuarios SET rol = 'consulta' WHERE rol NOT IN ('admin', 'editor', 'consulta', 'obra', 'regente', 'prestamos')");

    console.log('✅ Base de datos inicializada correctamente');
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };

