'use strict';
require('array.prototype.find');

function _module(config) {

    if ( !(this instanceof _module) ){
        return new _module(config);
    }

    const redis = require('redis');
    var moment = require('moment');
    const logger = require('sentinel-common').logger;

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('end', function(e){
        logger.info('Redis hung up, committing suicide');
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
        logger.info( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: global.moduleName, id : key });
        logger.info( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: global.moduleName, id : key, value : value });
        logger.info( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

    panel.on('raw.data', (data) => {
    });

    panel.on('rfx.data', (data) => {
    });

    function setSensorTrippedState( data, type, value ){

        let v;

        switch ( type ){
        case 'sensor.contact':
            v = data.contact;
            break;
        case 'sensor.motion':
            v = data.motion;
            break;
        case 'sensor.co2':
            v = data.co2;
            break;
        case 'sensor.smoke':
            v = data.smoke;
            break;
        }

        if ( v !== undefined ) {
            v.tripped.current = value;
            if (value === true) {
                v.tripped.last = new Date();
            }
        }

        return data;
    }

    panel.on('panel.connected', (data) => {

        that.getDeviceStatus( (config.id) )
            .then((status) =>{
                if ( status == null )
                    return;
                status.connected = true;
                statusCache.set( config.id, status );
                logger.trace(JSON.stringify(status));
            })
            .catch( (err) =>{
                if ( err.errorcode !== "ENOTFOUND")
                    logger.error(err);
            });
    });

    panel.on('panel.disconnected', (data) => {

        that.getDeviceStatus( (config.id) )
            .then((status) =>{
                if ( status == null )
                    return;
                status.connected = false;
                statusCache.set( config.id, status );
                logger.trace(JSON.stringify(status));
            })
            .catch( (err) =>{
                logger.error(err);
            });
    });

    panel.on('zone.trip', (data) => {

        let id = data.partition + '_' + data.number;

        let deviceInfo;

        this.getDevice(id)
            .then( (data) =>{
                deviceInfo = data;
                return this.getDeviceStatus(id);
            })
            .then( (status) =>{
                statusCache.set(id, setSensorTrippedState( status, deviceInfo.type, true ) );
            })
            .catch( (err) => {

            });

        logger.trace(JSON.stringify(data));
    });

    panel.on('zone.clear', (data) => {

        let id = data.partition + '_' + data.number;

        let deviceInfo;

        this.getDevice(id)
            .then( (data) =>{
                deviceInfo = data;
                return this.getDeviceStatus(id);
            })
            .then( (status) =>{
                statusCache.set(id, setSensorTrippedState( status, deviceInfo.type, false ) );
            })
            .catch( (err) => {

            });

        logger.trace(JSON.stringify(data));
    });

    panel.on('panel.data', (data) => {

        that.getDeviceStatus( (config.id) )
            .then((status) =>{

                if ( status == null )
                    return;

                delete data.flags.backlight;
                delete data.flags.programming;
                delete data.flags.beep;
                delete data.flags.bypass;
                delete data.flags.low_battery;
                delete data.flags.armed_zero_entry_delay;
                delete data.flags.check_zone;
                delete data.flags.perimeter_only;

                delete data.zone;

                status = merge(status, data);

                statusCache.set( config.id, status );

                logger.trace(JSON.stringify(status));
            })
            .catch( (err) =>{
                if ( err.errorcode !== "ENOTFOUND")
                    logger.error(err);
            });

    });

    this.setChimeState = ( id, state ) => {
        return new Promise( (fulfill, reject) => {

            this.getDevice(id)
                .then( () =>{
                    panel.setChimeState( state  )
                        .then( (data)=>{
                            fulfill(data);
                        })
                        .catch( (err) => {
                            reject(err);
                        });
                })
                .catch( (err) => {
                    reject({code: '404', message: 'not found'});
                });
        });

    };

    this.disarm = (id) => {
        return this.setMode( id, 'disarm' );
    };

    this.setMode = ( id, mode ) => {

        return new Promise( (fulfill, reject) => {

            this.getDevice(id)
                .then( () =>{
                    panel.setMode( mode )
                        .then( (data)=>{
                            fulfill(data);
                        })
                        .catch( (err) => {
                            reject(err);
                        });
                })
                .catch( (err) => {
                    reject({code: '404', message: 'not found'});
                });
        });

    };

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

    this.getDevice = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                deviceCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
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

            let d = {
                id: config.id,
                name: config.name,
                type: 'alarm.panel'
            };

            deviceCache.set(d.id, d);

            statusCache.set( d.id, {} );

            panel.getZones()
                .then( (zones) =>{

                    Object.keys(zones).forEach( (i) => {

                        let zone = zones[i];

                        let type;
                        let subType;

                        switch (zone.type){
                            case '00': // disabled
                                break;
                            case '01': // Entry/Exit 01
                            case '02': // Entry/Exit 02
                            case '03': // Perimeter
                                type = 'sensor';
                                subType = 'contact';
                                break;
                            case '04': // Interior Follower
                                type = 'sensor';
                                subType = 'motion';
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
                                type = 'sensor';
                                subType = 'smoke';
                                break;
                            case '10': // Interior w/Delay
                                type = 'sensor';
                                subType = 'motion';
                                break;
                            case '12': // Monitor Zone
                                break;
                            case '14': // Carbon Monoxide
                                type = 'sensor';
                                subType = 'co2';
                                break;
                            case '16': // Fire w/Delay
                                type = 'sensor';
                                subType = 'smoke';
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
                                type: type + (subType !== undefined ? '.' + subType : '' )
                            };

                            deviceCache.set(d.id, d);

                            let s = {};

                            s[subType] = {
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
                    logger.error(err);
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
                        logger.error(err);
                        setTimeout(pollSystem, 60000);
                    });

            }

            setTimeout(pollSystem, 10000);

        })
        .catch((err) => {
            logger.error(err);
            process.exit(1);
        });

    return this;
}

module.exports = _module;