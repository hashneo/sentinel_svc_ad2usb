'use strict';

module.exports.setChimeMode = (req, res) => {

    let id = req.swagger.params.id.value;
    let state = req.swagger.params.state.value;

    global.module.setChimeState( id, state )
        .then( (data) => {
            res.json( { data: data, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(err.code >= 400 && err.code <= 451 ? err.code : 500).json( { code: err.code || 0, message: err.message } );
        });
};


module.exports.disarm = (req, res) => {

    let id = req.swagger.params.id.value;

    global.module.disarm(id)
        .then( (data) => {
            res.json( { data: data, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(err.code >= 400 && err.code <= 451 ? err.code : 500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.setMode = (req, res) => {

    let id = req.swagger.params.id.value;
    let mode = req.swagger.params.mode.value;

    global.module.setMode( id, mode )
        .then( (data) => {
            res.json( { data: data, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(err.code >= 400 && err.code <= 451 ? err.code : 500).json( { code: err.code || 0, message: err.message } );
        });
};




