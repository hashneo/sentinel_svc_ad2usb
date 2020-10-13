'use strict';

const EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const logger = require('sentinel-common').logger;

function PanelController(address, port){

    if ( !(this instanceof PanelController) ){
        return new PanelController(address, port);
    }

    const net = require('net');
    const split = require('split');

    let that = this;

    EventEmitter.call(this);

    let client = null;

    let panelState = {};

    let panelCommand = null;

    let zoneData = config.zones;

    let zones = {};

    let tripped_zones = new function(){

        let ztable = {};

        setInterval( () => {
            let now = new Date();
            Object.keys( ztable ).forEach( (z) =>{
                let d = now.getTime() - ztable[z].when.getTime();
                if ( ( d ) > (config.tripTimeout || 30 ) * 1000 ){
                    that.emit('zone.clear', zones[z]);
                    delete ztable[z];
                }
            });
        }, 1000 );

        this.trip = (z) => {

            if ( zones[z] ) {
                if (!ztable[z])
                    that.emit('zone.trip', zones[z]);

                ztable[z] = {
                    when: new Date()
                };
            }
        }
    };

    function processZoneData(zoneData) {

        return new Promise ( (fulfill, reject) => {

            try {
                let zones = [];
                zoneData.forEach((z) => {

                    let zi = {type: 0};

                    let parsers = {
                        zone: {
                            r: /Zn\s+ZT\s+P.{9}(\d+)\s+(\d+)\s+(\d+).*/i,
                            p: (data) => {
                                zi.number = data[1];
                                zi.type = data[2];
                                zi.partition = data[3];
                            }
                        },
                        name: {
                            r: /\*\s+\Zn\s+\d+\s+(.*)/i,
                            p: (data) => {
                                zi.name = data[1].trim();
                            }
                        },
                        serial: {
                            r: /\d+\s+\w+\s+S\/N.{4}\s+(.{4,6}-.{4,6}).{4}/i,
                            p: (data) => {
                                zi.serial = data[1];
                            }
                        }
                    };

                    let match;

                    z.forEach((zd) => {
                        Object.keys(parsers).forEach((key) => {
                            if ((match = parsers[key].r.exec(zd)) != null) {
                                parsers[key].p(match);
                            }
                        });
                    });

                    if (zi.type !== 0) {
                        zones[parseInt(zi.number)] = zi;
                    }
                });

                fulfill(zones);
            }
            catch(err) {
                reject(err);
            }
        });
    }

    async function asyncGetZones(){
        return await that.getZones();
    }

    function connect() {

        client = new net.Socket();

        client.setKeepAlive(true,20000);
        client.setTimeout(60000);

        logger.debug(`connecting to ${address}:${port}`);
        client.connect(port, address);

        client.on('timeout', () => {
            logger.debug('connection timeout');
            reconnect();
        });

        client.on('error', (err) => {
            logger.debug(`connection err => ${err}`);
            reconnect();
        });

        client.on('close', () => {
            logger.debug('connection closed');
            reconnect();
        });

        client.pipe(split()).on('data', (data) => {
            read(data.toString('ascii'));
        });

        // Get the Zones so we can ensure they are loaded/read
        asyncGetZones();

        function reconnect (){
            setTimeout(() => {
                //client.removeAllListeners(); // the important line that enables you to reopen a connection
                connect()
            }, 1000)
        }
    }


    function panelProcessor(data){

        let d = {
            flags: {},
            zone: parseInt(data[3]),
            message: data[5]
        };

        let part = data[1].split('');

        d.flags.ready = part.shift() === '1';
        d.flags.armed_away = part.shift() === '1';
        d.flags.armed_stay = part.shift() === '1';
        d.flags.backlight = part.shift() === '1';
        d.flags.programming = part.shift() === '1';
        d.flags.beep = part.shift();
        d.flags.bypass = part.shift() === '1';
        d.flags.ac_power = part.shift() === '1';
        d.flags.chime = part.shift() === '1';
        d.flags.alarm_in_memory = part.shift() === '1';
        d.flags.alarm = part.shift() === '1';
        d.flags.low_battery = part.shift() === '1';
        d.flags.armed_zero_entry_delay = part.shift() === '1';
        d.flags.fire = part.shift() === '1';
        d.flags.check_zone = part.shift() === '1';
        d.flags.perimeter_only = part.shift() === '1';

        panelState = d;

        if ( panelCommand != null ){
            panelCommand.process(d);
        }

        if ( !d.flags.ready ) {

            if ( d.message.indexOf('Hit * for faults') !== -1 ){
                send( '*', () => { return true },3000 );
            } else {
                tripped_zones.trip(d.zone);
            }
        }

        return d;
    }

    function rfxProcessor(data){

        let RFX_FLAG = {
            UNKNOWN: 1,
            LOW_BATTERY: 2,
            SUPERVISION: 4,
            UNKNOWN2: 8,
            LOOP3: 16,
            LOOP2: 32,
            LOOP4: 64,
            LOOP1: 128
        };

        let d = {
            serial: data[1],
            flags: {loop: [0, 0, 0, 0]}
        };

        let flags = parseInt("0x" + data[2]);

        d.flags.low_battery = (( flags & RFX_FLAG.LOW_BATTERY ) !== 0);
        d.flags.supervision = (( flags & RFX_FLAG.SUPERVISION ) !== 0);
        d.flags.loop[3] = (( flags & RFX_FLAG.LOOP4 ) !== 0);
        d.flags.loop[2] = (( flags & RFX_FLAG.LOOP3 ) !== 0);
        d.flags.loop[1] = (( flags & RFX_FLAG.LOOP2 ) !== 0);
        d.flags.loop[0] = (( flags & RFX_FLAG.LOOP1 ) !== 0);

        let serial = 'A' + d.serial.substring(0,3) + '-' + d.serial.substring(3);

        Object.keys(zones).forEach( (z) => {
            if ( zones[z].serial && zones[z].serial === serial ){
                d.zone =  zones[z];
            }
        });

        return d;
    }

    function commandSent(){
        // do nothing
    }

    let messages = {
        panel : {
            r : /\[([01]{5}[0-9]{1}[01]{10})([0-9a-f\-]{4})\],([0-9a-f\-]{3}),\[([0-9a-f]{0,32})\],\"(.*)\"/i,
            p : panelProcessor
        },
        rfx : {
            r : /!RFX:([0-9a-f]+),([0-9a-f]{2})/i,
            p : rfxProcessor
        },
        send : {
            r : /!Sending\.+done/i,
            p : commandSent
        }
    };

    function read(data){

        if ( data.length === 0 )
            return;

        logger.debug (`==> '${data}'`);

        that.emit('raw.data', data);

        let match = null;

        let wasMatched = false;

        Object.keys(messages).forEach( (key) => {
            if ( ( match = messages[key].r.exec( data ) ) != null )  {
                wasMatched = true;
                that.emit(key + '.data', messages[key].p(match));
            }
        });

        if (!wasMatched){
           logger.debug( `${data} - not matched!`)
        }

    }

    this.getZones = () => {
        return new Promise( (fulfill, reject) => {

            if ( zoneData.length === 0  ){

                let panel;
/*
                this.programmingMode.open()
                    .then( (p) => {
                        panel = p;
                        return panel.readZones();
                    })
                    .then( (data) => {
                        panel.close();

                        config.zones = data;
                        config.save();

                        return processZoneData(data);
                    })
                    .then( (data) => {
                        zones = data;

                        return fulfill(zones);
                    })
                    .catch((err) =>{
                        reject(err);
                    });
                    */
            } else {

                if ( Object.keys(zones).length === 0 ) {
                    processZoneData( zoneData )
                        .then((z) => {
                            zones = z;
                            fulfill(zones);
                        });
                } else {
                    fulfill(zones);
                }
            }

        });

    };

    this.programmingMode = new function (){

        function sendAndWait(cmd, ignoreChange){
            return new Promise( (fulfill, reject) => {
                let currentMessage = panelState.message;
                send(cmd, (panel) => {
                    return (panel.message !== currentMessage) || ignoreChange;
                }, 30000)
                    .then( (data) =>{
                        fulfill(data.message);
                    })
                    .catch( (err) => {
                        reject(err);
                    })
            });
        }

        async function readZone(z){

            if ( z !== null ) {
                await sendAndWait(z, true);
            }

            let result = {
                data: []
            };

            let match;

            let zonePrompt = '';

            while ( true ){
                let msg = await sendAndWait('*', true );

                let r = /Zn\s+ZT\s+P.{9}(\d+).*/i;

                if ( ( match = r.exec(msg) ) != null ){
                    result.current = parseInt(match[1]);
                }

                r = /\d+\s+\w+\s+S\/N.{4}\s+(.{4,6}-.{4,6}).{4}/i;
                if ( ( match = r.exec(msg) ) != null ){
                    result.serial = match[1];
                }

                if (msg === 'Program Alpha?  0=No,1=Yes     0'){
                    await sendAndWait('1' );
                    let name = await sendAndWait('0' );
                    result.data.push(name);
                    zonePrompt = await sendAndWait('#');
                    break;
                }

                if ( msg === 'Delete Zone?    0=No,1=Yes     0'){
                    zonePrompt = await sendAndWait('0' );
                    break;
                }

                result.data.push(msg);

            }

            let r = /Enter\s+Zn\s+Num.\s+00=Quit\s+(\d+)/i;

            if ( ( match = r.exec(zonePrompt) ) != null ){
                result.next = parseInt(match[1]);
            }else{
                throw new Error('unknown state');
            }

            return result;
        }

        function readAndProcessZones(){
            return new Promise( (fulfill, reject) => {

                (async function() {
                    let zoneData = [];
                    let currentZone = 0;
                    let nextZone = 1;
                    while ( nextZone > currentZone ){
                        let z = `${nextZone}`.padStart(2,'0');
                        let result = await readZone( null );
                        currentZone = result.current;
                        nextZone = result.next;
                        zoneData.push( result.data );
                    }
                    fulfill(zoneData);
                })();

            });
        }

        this.open = () => {
            return new Promise( (fulfill, reject) =>{
                send(config.installerCode + '800', (panel) => {
                    return panel.flags.programming;
                }, 30000)
                    .then( (data) => {
                        fulfill(this);
                    })
                    .catch( (err) => {
                        reject (err);
                    })
            });
        };

        this.readZones = () => {

            return new Promise( (fulfill, reject) => {
                send('*56', (panel) => {
                    return panel.message === 'Set to Confirm? 0=No,1=Yes     0';
                }, 30000)
                    .then( () =>{
                        return send('0', (panel) => {
                            return panel.message === 'Enter Zn Num.   00=Quit       01';
                        }, 30000)
                    })
                    .then( (d) => {
                        return readAndProcessZones();
                    })
                    .then( (d) => {
                        logger.debug(d);

                        return send('00', (panel) => {
                            return panel.message === 'Enter * or #                    ';
                        }, 30000)
                    })
                    .then( (d) => {
                        fulfill();
                    })
                    .catch((err) => {
                        reject(err);
                    })
            });
        };

        this.exit = () => {
            return send( '*99', (panel) => {
                return !panel.flags.programming;
            } , 30000 );
        };


    };

    function send ( cmd, func, t ) {
        return new Promise( (fulfill, reject) => {

            logger.debug (`<== '${cmd}'`);

            panelCommand = {
                write: () => {
                    if ( !client.write( cmd + '\r\n' ) ) {
                        return reject('error');
                    }
                },
                retry: 5,
                clear: () => {
                    clearInterval(panelCommand.timeout);
                    panelCommand = null;
                },
                process : (data) => {
                    if ( func(data) ){
                        panelCommand.clear();
                        fulfill(data);
                    }
                },
                timeout : setInterval( () =>{

                    if (panelCommand.retry > 0){
                        panelCommand.retry--;
                        panelCommand.write();
                        return;
                    }
                    panelCommand.clear();
                    reject('timeout');
                }, 5000 )
            };

            panelCommand.write();

        });
    }

    connect();

}

PanelController.prototype = Object.create(EventEmitter.prototype);

module.exports = PanelController;