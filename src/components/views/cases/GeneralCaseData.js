/*
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

import React from "react";
import PropTypes from 'prop-types';
import {_t} from "../../../languageHandler";
import Field from "../elements/Field";

module.exports = React.createClass({
    displayName: "GeneralCaseData",
    propTypes: {
        data: PropTypes.object,
    },

    _onTitleChanged: function(e) {
        this.props.data.title = e.target.value;
    },

    render: function() {
      return (
            <div>
                <div className="aw_CreateCaseDialog_label">
                    <label htmlFor="textinput"> { _t('Title') } </label>
                </div>
                <div className="aw_CreateCaseDialog_input_container">
                    <input id="textinput" ref="textinput" className="aw_CreateCaseDialog_input" autoFocus={true} value={this.props.data.title} onChange={this._onTitleChanged} />
                </div>
                <div className="aw_CreateCaseDialog_label">
                    <label htmlFor="textinput"> { _t('Message') } </label>
                </div>
                <div className="aw_CreateCaseDialog_input_container">
                    <input id="textinput" ref="textinput" className="aw_CreateCaseDialog_input" value={this.props.data.note} />
                </div>
                <Field id="recipient" label={_t("Recipient")} element="select"
                       value={this.props.data.recipient}>
                    <option value="@marco.festini:test.amp.chat">{_t("Marco")}</option>
                    <option value="@michael.albert:test.amp.chat">{_t("Michael")}</option>
                    <option value="@videotest:test.amp.chat">{_t("Videotest")}</option>
                    <option value="@test12:test.amp.chat">{_t("Test12")}</option>
                </Field>
                <br />
                <Field id="severity" label={_t("Severity")} element="select"
                       value={this.props.data.severity}>
                    <option value="critical">{_t("Critical")}</option>
                    <option value="urgent">{_t("Urgent")}</option>
                    <option value="normal">{_t("Normal")}</option>
                    <option value="info">{_t("Info")}</option>
                </Field>
            </div>
          );
    },
});
