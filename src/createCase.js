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

        //debugger;

        // TODO set room image corresponding to severity
        let severityIcon;
        switch(createOpts.caseData.caseContent.severity){
          case 'critical':
            severityIcon = require("../res/img/severity_critical.png");
            break;
          case 'urgent':
            severityIcon = require("../res/img/severity_urgent.png");
            break;
          case 'request':
            severityIcon = require("../res/img/severity_request.png");
            break;
          case 'info':
          default:
            severityIcon = require("../res/img/severity_info.png");
            break;
        };

        /* TODO
        const uri = client.uploadContent(severityIcon);
        client.sendStateEvent(roomId, 'm.room.avatar', {url: uri}, '');
        */

        // send state event case data
        client._sendCompleteEvent(roomId, {
          type: 'case.amp.case',
          state_key: 'case.amp.case',
          content: createOpts.caseData.caseContent,
        });

        // send state event patient data
        client._sendCompleteEvent(roomId, {
          type: 'case.amp.patient',
          state_key: 'case.amp.patient',
          content: createOpts.caseData.patientContent,
        });

        // send observation message events
        for(let i=0; i<=createOpts.caseData.observationsContent.lenght-1; i++){
          client.sendEvent(roomId, 'care.amp.observation', createOpts.caseData.observationsContent[i]).done(() => {
              dis.dispatch({action: 'message_sent'});
          }, (err) => {
              dis.dispatch({action: 'message_send_failed'});
          });
        }

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
        /*client.sendEvent(roomId, 'care.amp.observation', observationsContent).done(() => {
            dis.dispatch({action: 'message_sent'});
        }, (err) => {
            dis.dispatch({action: 'message_send_failed'});
        });
        */
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
