/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2019 Awesome Technologies Innovationslabor GmbH

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import MatrixClientPeg from './MatrixClientPeg';
import Modal from './Modal';
import sdk from './index';
import { _t } from './languageHandler';
import dis from "./dispatcher";
import * as Rooms from "./Rooms";

import Promise from 'bluebird';
import {getAddressType} from "./UserAddress";
import MultiInviter from './utils/MultiInviter';
import Matrix from "matrix-js-sdk";

/**
 * Invites multiple addresses to a room
 * Simpler interface to utils/MultiInviter but with
 * no option to cancel.
 *
 * @param {string} roomId The ID of the room to invite to
 * @param {string[]} addrs Array of strings of addresses to invite. May be matrix IDs or 3pids.
 * @returns {Promise} Promise
 */
function inviteMultipleToRoom(roomId, addrs) {
    const inviter = new MultiInviter(roomId);
    return inviter.invite(addrs).then(states => Promise.resolve({states, inviter}));
}

function _sendStateEvent(roomId, eventObject, txnId, callback) {
    const client = MatrixClientPeg.get();

    // check if txnId is the callback function
    if (Object.prototype.toString.call(txnId) == "[object Function]") {
        callback = txnId; txnId = undefined;
    }

    if (!txnId) {
        txnId = client.makeTxnId();
    }

    // we always construct a MatrixEvent when sending because the store and
    // scheduler use them. We'll extract the params back out if it turns out
    // the client has no scheduler or store.
    const localEvent = new Matrix.MatrixEvent(Object.assign(eventObject, {
        event_id: "~" + roomId + ":" + txnId,
        user_id: client.credentials.userId,
        room_id: roomId,
        origin_server_ts: new Date().getTime(),
    }));

    const room = client.getRoom(roomId);

    // if this is a relation or redaction of an event
    // that hasn't been sent yet (e.g. with a local id starting with a ~)
    // then listen for the remote echo of that event so that by the time
    // this event does get sent, we have the correct event_id
    /*const targetId = localEvent.getAssociatedId();
    if (targetId && targetId.startsWith("~")) {
        const target = room.getPendingEvents().find(e => e.getId() === targetId);
        target.once("Event.localEventIdReplaced", () => {
            localEvent.updateAssociatedId(target.getId());
        });
    }*/

    const type = localEvent.getType();
    console.log(`sendEvent of type ${type} in ${roomId} with txnId ${txnId}`);
    console.log(localEvent);

    localEvent._txnId = txnId;
    localEvent.setStatus(Matrix.EventStatus.SENDING);

    // add this event immediately to the local store as 'sending'.
    if (room) {
        room.addPendingEvent(localEvent, txnId);
    }

    // addPendingEvent can change the state to NOT_SENT if it believes
    // that there's other events that have failed. We won't bother to
    // try sending the event if the state has changed as such.
    if (localEvent.status === Matrix.EventStatus.NOT_SENT) {
        return Promise.reject(new Error("Event blocked by other events not yet sent"));
    }

    return _sendEncryptedStateEvent(client, room, localEvent, callback);
};

// encrypts the event if necessary
// adds the event to the queue, or sends it
// marks the event as sent/unsent
// returns a promise which resolves with the result of the send request
function _sendEncryptedStateEvent(client, room, event, callback) {

    // Add an extra Promise.resolve() to turn synchronous exceptions into promise rejections,
    // so that we can handle synchronous and asynchronous exceptions with the
    // same code path.
    return Promise.resolve().then(function() {
        const encryptionPromise = _encryptEventIfNeeded(client, event, room);

        if (!encryptionPromise) {
            return null;
        }

        _updatePendingEventStatus(room, event, Matrix.EventStatus.ENCRYPTING);
        return encryptionPromise.then(() => {
            _updatePendingEventStatus(room, event, Matrix.EventStatus.SENDING);
        });
    }).then(function() {
        let promise;
        // this event may be queued
        if (client.scheduler) {
            // if this returns a promsie then the scheduler has control now and will
            // resolve/reject when it is done. Internally, the scheduler will invoke
            // processFn which is set to this._sendEventHttpRequest so the same code
            // path is executed regardless.
            promise = client.scheduler.queueEvent(event);
            if (promise && client.scheduler.getQueueForEvent(event).length > 1) {
                // event is processed FIFO so if the length is 2 or more we know
                // this event is stuck behind an earlier event.
                _updatePendingEventStatus(room, event, Matrix.EventStatus.QUEUED);
            }
        }

        if (!promise) {
            promise = _sendEventHttpRequest(client, event);
        }
        return promise;
    }).then(function(res) {  // the request was sent OK
        if (room) {
            room.updatePendingEvent(event, Matrix.EventStatus.SENT, res.event_id);
        }
        if (callback) {
            callback(null, res);
        }
        return res;
    }, function(err) {
        // the request failed to send.
        logger.error("Error sending event", err.stack || err);

        try {
            // set the error on the event before we update the status:
            // updating the status emits the event, so the state should be
            // consistent at that point.
            event.error = err;
            _updatePendingEventStatus(room, event, Matrix.EventStatus.NOT_SENT);
            // also put the event object on the error: the caller will need this
            // to resend or cancel the event
            err.event = event;

            if (callback) {
                callback(err);
            }
        } catch (err2) {
            logger.error("Exception in error handler!", err2.stack || err);
        }
        throw err;
    });
}

/**
 * Create a new case, and switch to it.
 *
 * @param {object=} opts parameters for creating the room
 * @param {string=} opts.dmUserId If specified, make this a DM room for this user and invite them
 * @param {object=} opts.createOpts set of options to pass to createRoom call.
 *
 * @returns {Promise} which resolves to the room id, or null if the
 * action was aborted or failed.
 */
function createCase(opts) {
    opts = opts || {};

    const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
    const Loader = sdk.getComponent("elements.Spinner");

    const client = MatrixClientPeg.get();
    if (client.isGuest()) {
        dis.dispatch({action: 'require_registration'});
        return Promise.resolve(null);
    }

    const defaultPreset = opts.dmUserId ? 'trusted_private_chat' : 'private_chat';

    // set some defaults for the creation
    const createOpts = opts.createOpts || {};
    createOpts.preset = createOpts.preset || defaultPreset;
    createOpts.visibility = createOpts.visibility || 'private';
    if (opts.dmUserId && createOpts.invite === undefined) {
        switch (getAddressType(opts.dmUserId)) {
            case 'mx-user-id':
                createOpts.invite = [opts.dmUserId];
                break;
            case 'email':
                createOpts.invite_3pid = [{
                    id_server: MatrixClientPeg.get().getIdentityServerUrl(true),
                    medium: 'email',
                    address: opts.dmUserId,
                }];
        }
    }
    if (opts.dmUserId && createOpts.is_direct === undefined) {
        createOpts.is_direct = true;
    }

    // By default, view the room after creating it
    if (opts.andView === undefined) {
        opts.andView = true;
    }

    // Allow guests by default since the room is private and they'd
    // need an invite. This means clicking on a 3pid invite email can
    // actually drop you right in to a chat.
    createOpts.initial_state = createOpts.initial_state || [
        {
            content: {
                guest_access: 'forbidden',
            },
            type: 'm.room.guest_access',
            state_key: '',
        },
        {
            content: {
                algorithm: 'm.megolm.v1.aes-sha2',
            },
            type: 'm.room.encryption',
            state_key: '',
        },
    ];

    const modal = Modal.createDialog(Loader, null, 'mx_Dialog_spinner');

    let roomId;

    return client.createRoom(createOpts).finally(function() {
        modal.close();
    }).then(function(res) {
        roomId = res.room_id;
        if (opts.dmUserId) {
            return Rooms.setDMRoom(roomId, opts.dmUserId);
        } else {
            return Promise.resolve();
        }
    }).then(function() {

        // invite recipients
        if (createOpts.invitees !== undefined) {
          let inv_res = inviteMultipleToRoom(roomId, createOpts.invitees);
        }
        /*client._showAnyInviteErrors(inv_res.states, room, inv_res.inviter).catch((err) => {
            console.error(err.stack);
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            Modal.createTrackedDialog('Failed to invite', '', ErrorDialog, {
                title: _t("Failed to invite"),
                description: ((err && err.message) ? err.message : _t("Operation failed")),
            });*/

        // TODO set room image corresponding to severity


        // TODO send case data to room
        let caseContent;
        caseContent = {
          title: "Kopfwunde nach Treppensturz",
          note: "Frau Müller ist eine Treppe hinuntergestürzt und hat sich dabei den Kopf gestoßen. Ich sende Ihnen Bilder der Wunde.",
          severity: "urgent",
          requester: {
            reference: "Pflegeheim/Maier",
          }
        };

        let patientContent;
        patientContent = { name: "Hannelore Maier", gender: "female", birthDate: "1932-04-21",
        managingOrganization: { reference: "Pflegeheim" }, generalPractitioner: { reference: "Arzt" }
        };

        let observationsContent;
        observationsContent = {
          category: { coding: [{ code: "vital-signs",
          display: "Vital Signs",
          system: "http://hl7.org/fhir/observation-category"
        }], text: "Vital Signs" }, code: { coding: [{ code: "8867-4", display: "Heart rate", system: "http://loinc.org" }],
        text: "Heart rate" }, effectiveDateTime: "2018-10-12T00:00:00", id: "heart-rate", meta: { profile: "http://hl7.org/fhir/StructureDefinition/vitalsigns" },
        resourceType: "Observation", subject: "Patient/Hannelore Maier", valueQuantity: {  code: "/min",  system: "http://unitsofmeasure.org", unit: "beats/minute",
        value: 82 }
        };

        // state event case data
        const eventObject = {
          type: 'case.amp.case',
          state_key: 'case.amp.case',
          content: caseContent,
        };

        debugger;
        
        client._sendCompleteEvent(roomId, {
          type: 'case.amp.case',
          state_key: 'case.amp.case',
          content: caseContent,
        });
        //_sendStateEvent(roomId, eventObject);

        /*
        const localEvent = new Matrix.MatrixEvent(Object.assign(eventObject, {
            event_id: "~" + roomId + ":" + client.makeTxnId(),
            user_id: client.credentials.userId,
            room_id: roomId,
            origin_server_ts: new Date().getTime(),
        }));
        let encryptedCaseEvent = client._crypto.encryptEvent(localEvent, roomId);

        console.log("AMP.care: encrypted Event:");
        console.log(encryptedCaseEvent);

        client.sendStateEvent(roomId, 'm.room.encrypted', encryptedCaseEvent, 'care.amp.case');
        */

        // state event patient data
        //client.sendStateEvent(roomId, 'm.room.encrypted', patientContent, 'care.amp.patient');

        // message event observation data
        client.sendEvent(roomId, 'care.amp.observation', observationsContent).done(() => {
            dis.dispatch({action: 'message_sent'});
        }, (err) => {
            dis.dispatch({action: 'message_send_failed'});
        });
        //client.sendEvent(roomId, 'care.amp.observation', observationsContent);

        return roomId;
    }).then(function() {
        // NB createRoom doesn't block on the client seeing the echo that the
        // room has been created, so we race here with the client knowing that
        // the room exists, causing things like
        // https://github.com/vector-im/vector-web/issues/1813
        if (opts.andView) {
            dis.dispatch({
                action: 'view_room',
                room_id: roomId,
                should_peek: false,
                // Creating a room will have joined us to the room,
                // so we are expecting the room to come down the sync
                // stream, if it hasn't already.
                joining: true,
            });
        }
        return roomId;
    }, function(err) {
        // We also failed to join the room (this sets joining to false in RoomViewStore)
        dis.dispatch({
            action: 'join_room_error',
        });
        console.error("Failed to create case " + roomId + " " + err);
        let description = _t("Server may be unavailable, overloaded, or you hit a bug.");
        if (err.errcode === "M_UNSUPPORTED_ROOM_VERSION") {
            // Technically not possible with the UI as of April 2019 because there's no
            // options for the user to change this. However, it's not a bad thing to report
            // the error to the user for if/when the UI is available.
            description = _t("The server does not support the room version specified.");
        }
        Modal.createTrackedDialog('Failure to create case', '', ErrorDialog, {
            title: _t("Failure to create case"),
            description,
        });
        return null;
    });
}

module.exports = createCase;
