'use strict';

module.exports.setChimeMode = (req, res) => {
    global.module.setChimeMode( req.swagger.params.state.value )
        .then( (data) => {
            res.json( { data: data, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};


module.exports.disarm = (req, res) => {
    global.module.disarm()
        .then( (data) => {
            res.json( { data: data, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.setMode = (req, res) => {
    global.module.setMode( req.swagger.params.state.value )
        .then( (data) => {
            res.json( { data: data, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};




