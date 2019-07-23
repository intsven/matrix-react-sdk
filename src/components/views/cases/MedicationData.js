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

import React from 'react';
import {_t} from "../../../languageHandler";
import Field from "../elements/Field";
import classNames from 'classnames';

export default class MedicationData extends React.Component {
    constructor() {
        super();
        this.state = {
            activeAgent: '',
            brand: '',
            strength: '',
            form: '',
            mo: '',
            no: '',
            ev: '',
            ni: '',
            unit: '',
            notes: '',
            reason: '',
        };
    }

    _onActiveAgentChanged = (e) => {
        this.setState({
            activeAgent: e.target.value,
        });
    };

    _onBrandChanged = (e) => {
        this.setState({
            brand: e.target.value,
        });
    };

    _onStrengthChanged = (e) => {
        this.setState({
            strength: e.target.value,
        });
    };

    render() {
        return (
            <div className="mx_ProfileSettings_profile">
            <Field id="profileDisplayName" label={_t("Active agent")}
                               type="text" value={this.state.activeAgent} autoComplete="off"
                               onChange={this._onActiveAgentChanged} />
            <Field id="profileDisplayName" label={_t("Brand")}
                               type="text" value={this.state.brand} autoComplete="off"
                               onChange={this._onBrandChanged} />
            <Field id="profileDisplayName" label={_t("Strength")}
                               type="text" value={this.state.strength} autoComplete="off"
                               onChange={this._onStrengthChanged} />
            </div>
        );
    }
}
