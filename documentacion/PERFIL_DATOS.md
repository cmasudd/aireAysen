# Perfil inicial de datos

Fecha del perfil: 10 de septiembre de 2026.

## Contrato confirmado

La consulta pública de Looker Studio ofrece series horarias agregadas por
sensor de `pm1`, `pm25` y `pm10`. El esquema remoto también enumera temperatura
y humedad, pero esos campos no están declarados por los gráficos publicados y
la consulta pública los rechaza. Por esa razón no se publican por suposición.

La primera extracción ampliada produjo 59.208 combinaciones sensor–hora, sin
claves duplicadas, entre el 11 de junio de 2024 y el 10 de septiembre de 2026 a
las 16:00.

## Cobertura

- Sensores con transmisión reciente al perfilar: 31, 32 y 39.
- Los demás sensores terminan en fechas distintas entre 2024 y 2026.
- Los períodos sin transmisión se conservan como brechas; no se interpolan.
- Los valores negativos o superiores a 5.000 µg/m³ se reservan como vacíos por
  ser físicamente imposibles o altamente sospechosos para este contrato.
- Los ceros se conservan porque pueden representar una observación válida del
  instrumento.

## Georreferencia

Los sensores 31 (INDOOR) y 39 (OUTDOOR) comparten `-45.61444, -72.10975`, a
278 m s. n. m. y aproximadamente 5,6 km al suroeste de Coyhaique. Para los
otros trece sensores sólo se conoce el área general de Coyhaique.

## Alcance normativo

Los datos son experimentales. La comparación diaria exige al menos 18 lecturas
horarias y se muestra sólo como orientación frente a DS 12/2011 (MP2,5) y DS
12/2021 (MP10). No reemplaza la evaluación en una estación EMRP ni los cálculos
estadísticos exigidos por la regulación.
