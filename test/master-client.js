'use strict';

let chai = require('chai');
let chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

let should = chai.should();
let Promise = require('bluebird');

let Master = require('..').Master;
let Client = require('..').Client;

describe.only('master-client', function() {

  let master, client;

  let cmd = {
    COMPLETE: 'complete',
    COMPLETE_WITH_PROGRESS: 'complete_with_progress',
    END_WITH_ERR: 'end_with_error',
    END_WITH_COMPLEX_ERR: 'end_with_complex_error',
    CANCEL_BY_MASTER: 'cancel_by_master',
    CANCEL_BY_CLIENT: 'cancel_by_client',
    TIMEOUT: 'timeout'
  };

  before(function(done) {

    this.timeout(10 * 1000);

    /** start up master **/
    master = new Master({ port: 3000 });

    /** handle commands **/

    master.execute(cmd.COMPLETE, (cmd, done) => {
      let pa = cmd['params'];
      setTimeout(() => done(null, pa.result), pa.delay || 0);
    });

    master.execute(cmd.COMPLETE_WITH_PROGRESS, (cmd, done, progress) => {

      let p = 0, pa = cmd['params'], hInterval;

      hInterval = setInterval(() => {
        p += 25;
        progress(p + '%');
        if (p == 100) {
          done(null, pa.result);
          clearInterval(hInterval);
        }
      }, 500);

    });

    master.execute(cmd.END_WITH_ERR, (cmd, done) => {
      let pa = cmd['params'];
      setTimeout(() => done(pa.error), pa.delay || 0);
    });

    master.execute(cmd.END_WITH_COMPLEX_ERR, (cmd, done) => {
      let pa = cmd['params'];
      setTimeout(() => done(pa.error), pa.delay || 0);
    });

    master.execute(cmd.CANCEL_BY_MASTER, (cmd, done, progress, cancel) => {
      setTimeout(() => cancel('cancel by master'), 500);
    });

    master.execute(cmd.CANCEL_BY_CLIENT, (cmd, done, progress, cancel) => {
      cmd.on('cancel', (reason) => {
        cancel(reason);
      });
    });

    master.execute(cmd.TIMEOUT, (cmd, done) => {
      setTimeout(() => done('OK?'), 3000);
    });

    master.listen(() => {

      console.log('master startup');

      /** start up worker **/
      client = new Client({ port: 3000 });
      client.connect(() => {
        console.log('client startup');
        done();
      });

    });

  });

  it('should work', function(done) {
    done();
  });

  it('should be ok and completed', function() {

    this.timeout(10 * 1000);

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.COMPLETE,
        params: { result: 'foo', delay: 1000 },
        onComplete: (ctx, result) => resolve({ command: ctx, result: result }),
        onError: (ctx, err) => reject(err)
      };

      /** send command from client to master **/
      client.publish(c);

    });

    return pro
      .then(r => {
        r.result.should.equal('foo');
        r.command.result.should.equal('foo');
        r.command.state.should.equal('completed');
        r.command.phase.should.equal(2);
      });

  });

  it('should be ok and completed with progress', function() {

    this.timeout(10 * 1000);

    let px = [], rx = { foo: 'foo', bar: 'bar' };

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.COMPLETE_WITH_PROGRESS,
        params: { result: rx },
        onComplete: (ctx, result) => resolve({ command: ctx, result: result }),
        onProgress: (ctx, p) => px.push(p),
        onError: (ctx, err) => reject(err)
      };

      /** send command from client to master **/
      client.publish(c);

    });

    return pro
      .then(r => {
        r.result.should.deep.equal(rx);
        r.command.result.should.deep.equal(rx);
        r.command.state.should.equal('completed');
        r.command.phase.should.equal(2);
        r.command.progress.should.deep.equal([ '25%', '50%', '75%', '100%' ]);
        px.should.deep.equal([ '25%', '50%', '75%', '100%' ]);
      })

  });

  it('should end with error', function() {

    this.timeout(10 * 1000);

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.END_WITH_ERR,
        params: {
          error: 'task should end with error',
          delay: 1000
        },
        onComplete: () => reject('should not be completed'),
        onError: (ctx, err) => resolve({ command: ctx, error: err })
      };

      /** send command from client to master **/
      client.publish(c);

    });

    return pro
      .then(r => {
        let cmd = r.command, err = r.error;
        cmd.state.should.equal('error');
        cmd.phase.should.equal(2);
        cmd.error.should.be.an('object');
        cmd.error.message.should.equal('task should end with error');
        err.should.be.an('object');
        err.message.should.equal('task should end with error');
      });

  });

  it('should end with complicated error', function() {

    this.timeout(10 * 1000);

    let err = {
      error: 'too bad',
      detail: 'check message for detail',
      message: 'task should end with complicated error',
      code: '500'
    };

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.END_WITH_COMPLEX_ERR,
        params: { error: err, delay: 1000 },
        onComplete: () => reject('should not be completed'),
        onError: (ctx, err) => resolve({ command: ctx, error: err })
      };

      /** send command from client to master **/
      client.publish(c);

    });

    return pro
      .then(r => {
        let cmd = r.command, err = r.error;
        cmd.state.should.equal('error');
        cmd.phase.should.equal(2);
        cmd.error.should.be.an('object').and.deep.equal(err);
        err.should.be.an('object').and.deep.equal(err);
      });

  });

  it('should be ok to cancel the command by master', function() {

    this.timeout(10 * 1000);

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.CANCEL_BY_MASTER,
        onComplete: () => reject('should not be completed'),
        onCancelled: (ctx) => resolve(ctx)
      };

      /** send command from client to master **/
      client.publish(c);

    });

    return pro
      .then(c => {
        c.state.should.equal('cancelled');
        c.phase.should.equal(2);
        c.isCancellationRequested.should.be.false;
      });
  });

  it('should be ok to cancel the command by client', function () {

    this.timeout(10 * 1000);

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.CANCEL_BY_CLIENT,
        onComplete: () => reject('should not be completed'),
        onCancelled: (ctx) => resolve(ctx)
      };

      /** send command from client to master **/
      let command = client.publish(c);
      setTimeout(() => command.cancel('just cancel it'), 1000);

    });

    return pro
      .then(c => {
        c.state.should.equal('cancelled');
        c.phase.should.equal(2);
        c.isCancellationRequested.should.be.true;
        c.cancellationReason.should.equal('just cancel it');
      });
  });

  it('should timeout', function() {

    this.timeout(10 * 1000);

    let pro = new Promise((resolve, reject) => {

      /** prepare command **/
      let c = {
        type: cmd.TIMEOUT,
        timeout: 2000,
        onComplete: () => reject('should not be completed'),
        onTimeout: (ctx) => resolve(ctx)
      };

      /** send command from client to master **/
      client.publish(c);

    });

    return pro
      .then(c => {
        c.state.should.equal('timeout');
        c.phase.should.equal(2);
      });

  });

});