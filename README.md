# Aire Aysén

Portal estático del Centro C+ de la Universidad del Desarrollo para explorar y
descargar observaciones de material particulado del proyecto `data Aysen`.

## Fuente

La fuente es un [informe público de Looker
Studio](https://datastudio.google.com/reporting/5a8d0e63-cfeb-4707-bd0e-ce093b1eacdd/page/p_xbr0ilpmid),
documentado inicialmente en
[`AleReb/data_Aysen_exports`](https://github.com/AleReb/data_Aysen_exports).
Este proyecto no consulta la base de datos de CMAS.

El descargador reproduce las consultas públicas del gráfico para obtener
promedios horarios de MP1, MP2,5 y MP10. Looker Studio no ofrece aquí un
endpoint de exportación documentado; por eso su contrato se valida en cada
ejecución y puede requerir mantenimiento si Google modifica el informe.

## Datos publicados

- INDOOR: sensores 26 a 33.
- OUTDOOR: sensores 34 a 40.
- Ubicación exacta disponible solamente para los sensores 31 y 39:
  `-45.61444, -72.10975`, 278 m s. n. m., aproximadamente 5,6 km al suroeste
  de Coyhaique.
- Los demás sensores se describen como pertenecientes al área de Coyhaique y
  no reciben coordenadas inventadas.
- CSV mensuales separados por sensor en `data/sensor-ID/AAAA-MM.csv`.

El navegador revisa `manifest.json` cada diez minutos. La fuente de Google se
descarga y publica una vez por hora mediante un clon exclusivo protegido con
`flock`.

## Ejecución manual

```bash
python3 -m pip install -r requirements.txt
python3 scripts/download_looker.py
```

La descarga total de la web genera localmente un ZIP con un CSV por sensor. No
ejecuta una consulta nueva contra Google.

## Automatización

```cron
43 * * * * /usr/bin/flock -n /tmp/aireAysen-update.lock /home/cmas/Documentos/aireAysen-publisher/scripts/update_data.sh >> /home/cmas/Documentos/aireAysen-publisher/data-update.log 2>&1
```

El minuto 43 evita coincidir con otros publicadores. El script sólo crea un
commit cuando cambia `data/`.

## Referencias normativas

- MP2,5: DS 12/2011 MMA, 50 µg/m³ como concentración de 24 horas.
- MP10: DS 12/2021 MMA, publicado en 2022, 130 µg/m³N como concentración de 24
  horas.
- MP1: sin norma primaria chilena general aplicable.

La comparación es orientativa. Estos instrumentos no se presentan como
estaciones EMRP y la web no determina cumplimiento normativo.

## Licenciamiento propuesto — en revisión

El esquema de [`LICENCIAMIENTO_PROPUESTO.md`](LICENCIAMIENTO_PROPUESTO.md) es
una propuesta pendiente de revisión jurídica e institucional. El repositorio
fuente no declara una licencia; no debe asumirse autorización general de
reutilización más allá de la publicación acordada para este proyecto.

## Pruebas

```bash
python3 -m unittest discover -s tests -v
node --check app.js
```
