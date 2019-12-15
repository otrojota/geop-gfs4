FROM otrojota/geoportal:gdal-nodejs
#ENV NODE_ENV production
WORKDIR /opt/geoportal/geop-base-proveedor-capas
COPY ../geop-base-proveedor-capas .
RUN npm install 
WORKDIR /opt/geoportal/geop-gfs4
COPY ../geop-gfs4 .
RUN npm install 
#EXPOSE 8085
CMD node index.js -download