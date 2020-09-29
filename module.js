'use strict';
require('array.prototype.find');

function _module(config) {

    if ( !(this instanceof _module) ){
        return new _module(config);
    }

    const redis = require('redis');
    var moment = require('moment');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

    var NodeCache = require( "node-cache" );

    var deviceCache = new NodeCache();
    var statusCache = new NodeCache();

    var merge = require('deepmerge');

    var net = require ('net');

    var request = require('request');
    var https = require('https');
    var keepAliveAgent = new https.Agent({ keepAlive: true });

    var panel = require('./panelController.js')( config.address, config.port );

/*
    require('request').debug = true
    require('request-debug')(request);
*/

    deviceCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        console.log( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: global.moduleName, id : key });
        console.log( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        console.log( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

    panel.on('raw.data', (data) => {
        //console.log(data);
    });

    panel.on('rfx.data', (data) => {
        //console.log(data);
    });

    panel.on('zone.trip', (data) => {

        let id = data.partition + '_' + data.number;

        this.getDeviceStatus(id)
            .then( (status) =>{
                status.tripped.current = true;
                status.tripped.last = new Date();
                statusCache.set(id, status);
            })
            .catch( (err) => {

            });

        console.log(data);
    });

    panel.on('zone.clear', (data) => {

        let id = data.partition + '_' + data.number;

        this.getDeviceStatus(id)
            .then( (status) =>{
                status.tripped.current = false;
                statusCache.set(id, status);
            })
            .catch( (err) => {

            });

        console.log(data);
    });

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

                });
            });
        });
    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            fulfill();
        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    function loadSystem(){
        return new Promise( ( fulfill, reject ) => {

            let devices = [];

            panel.getZones()
                .then( (zones) =>{

                    Object.keys(zones).forEach( (i) => {

                        let zone = zones[i];

                        let type;

                        switch (zone.type){
                            case '00': // disabled
                                break;
                            case '01': // Entry/Exit 01
                            case '02': // Entry/Exit 02
                            case '03': // Perimeter
                                type = 'sensor.contact';
                                break;
                            case '04': // Interior Follower
                                type = 'sensor.motion';
                                break;
                            case '05': // Trouble Day/Alarm Night
                                break;
                            case '06': // 24-Hr Silent
                                break;
                            case '07': // 24-Hr Audible
                                break;
                            case '08': // 24-Hr Aux
                                break;
                            case '09': // Fire
                                type = 'sensor.smoke';
                                break;
                            case '10': // Interior w/Delay
                                type = 'sensor.motion';
                                break;
                            case '12': // Monitor Zone
                                break;
                            case '14': // Carbon Monoxide
                                type = 'sensor.co2';
                                break;
                            case '16': // Fire w/Delay
                                type = 'sensor.smpke';
                                break;
                            case '20': // ARM/Stay (FOB)
                                break;
                            case '21': // ARM/Away (FOB)
                                break;
                            case '22': // Disarm (FOB)
                                break;
                            case '23': // No Alarm Resp (FOB)
                                break;
                            case '24': // Silent Burglary
                                break;
                            case '77': // Key Switch
                                break;
                            case '81': // AAV Monitor Zone
                                break;
                            case '90' : // Configurable
                                break;
                            case '91' : // Configurable
                                break;
                        }

                        if ( type ) {
                            let d = {
                                id: zone.partition + '_' + zone.number,
                                name: zone.name,
                                type: type
                            };

                            deviceCache.set(d.id, d);

                            let s = {
                                armed : true,
                                tripped: {
                                    last : null,
                                    current : false
                                }
                            };

                            if ( zone.serial ) {
                                s.battery = {
                                    level: 100
                                };
                            }

                            statusCache.set( d.id, s );

                            devices.push(d);
                        }
                    });

                })
                .catch ( (err) => {
                    console.log(err);
                });

            fulfill();
        });
    }

    loadSystem()

        .then( () => {

            function pollSystem() {
                updateStatus()
                    .then(() => {
                        setTimeout(pollSystem, 10000);
                    })
                    .catch((err) => {
                        console.error(err);
                        setTimeout(pollSystem, 60000);
                    });

            }

            setTimeout(pollSystem, 10000);

        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });

    return this;
}

module.exports = _module;